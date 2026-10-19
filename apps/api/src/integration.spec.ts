/**
 * End-to-end tests against a real PostgreSQL database (Socket.IO + REST).
 * Opt-in: set TEST_DATABASE_URL (see `npm run test:integration` in the repo root).
 */
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { seededRng } from '@akukulu/engines';
import { GAME_SLUGS, type BlackjackView, type LudoView, type MatchStatePayload, type PokerView } from '@akukulu/shared';
import { GamesService } from './games/games.service';
import { MatchRuntimeService } from './matches/match-runtime.service';
import { LedgerService } from './wallet/ledger.service';
import { client, connect, emitAck, initDataFor, startApp, type TestApp } from './testing/harness';

const DB = process.env.TEST_DATABASE_URL;
const suite = DB ? describe : describe.skip;
if (!DB) console.warn('Skipping API integration tests: TEST_DATABASE_URL is not set');

jest.setTimeout(120_000);

interface Player {
  id: string;
  token: string;
  socket: Socket;
  states: MatchStatePayload[];
}

suite('API integration', () => {
  let t: TestApp;
  let api: ReturnType<typeof client>;
  const sockets: Socket[] = [];
  let nextTelegramId = 1000;

  async function login(name: string, extra: Record<string, string> = {}): Promise<Player> {
    const res = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(nextTelegramId++, name, extra) });
    expect(res.status).toBe(200);
    const socket = await connect(t.url, res.body.token);
    sockets.push(socket);
    const player: Player = { id: res.body.user.id, token: res.body.token, socket, states: [] };
    socket.on('match:state', (s: MatchStatePayload) => player.states.push(s));
    return player;
  }

  const balance = async (p: Player) => (await api('GET', '/me', p.token)).body.balance as number;
  const state = async <V>(matchId: string, p: Player) => (await api('GET', `/matches/${matchId}/state`, p.token)).body as MatchStatePayload & { view: V };
  const act = (p: Player, matchId: string, action: Record<string, unknown>, clientActionId = randomUUID()) =>
    emitAck(p.socket, 'match:action', { matchId, clientActionId, action });

  async function startRoom(game: string, stake: number, players: Player[]): Promise<string> {
    const created = await api('POST', '/rooms', players[0].token, { gameSlug: game, stake, visibility: 'private' });
    expect(created.status).toBe(201);
    const code = created.body.code;
    for (const p of players.slice(1)) expect((await api('POST', `/rooms/${code}/join`, p.token)).status).toBe(200);
    for (const p of players) await emitAck(p.socket, 'room:subscribe', { code });
    let room;
    for (const p of players) room = (await api('POST', `/rooms/${code}/ready`, p.token, { ready: true })).body;
    expect(room.status).toBe('in_progress');
    return room.matchId;
  }

  beforeAll(async () => {
    t = await startApp(DB!, { dropSchema: true });
    api = client(t.url);
    t.app.get(MatchRuntimeService).rng = seededRng(2024);
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await t?.close();
  });

  it('serves exactly the four-game catalog and prunes legacy games', async () => {
    const ds = t.app.get(DataSource);
    await ds.query(`INSERT INTO games (slug, name, tagline, description, "minPlayers", "maxPlayers") VALUES ('bingo','Bingo','x','x',1,1)`);
    await t.app.get(GamesService).syncCatalog();
    const res = await api('GET', '/games');
    expect(res.body.map((g: { slug: string }) => g.slug)).toEqual([...GAME_SLUGS]);
    const bySlug = Object.fromEntries(res.body.map((g: { slug: string }) => [g.slug, g]));
    expect(bySlug.ludo.playable).toBe(true);
    expect(bySlug.conquer).toMatchObject({ playable: false, maintenance: true });
  });

  it('verifies Telegram initData on the backend and grants the welcome bonus once', async () => {
    const bad = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(1, 'Eve').replace('Eve', 'Mallory') });
    expect(bad.status).toBe(401);
    const res = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(77, 'Abebe') });
    expect(res.body.user.balance).toBe(1000);
    const again = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(77, 'Abebe') });
    expect(again.body.user.balance).toBe(1000);
    expect((await api('GET', '/me')).status).toBe(401);
  });

  it('credits a referral exactly once', async () => {
    const referrer = await login('Referrer');
    const code = (await api('GET', '/me', referrer.token)).body.referralCode;
    await login('Friend', { start_param: `ref_${code}` });
    expect(await balance(referrer)).toBe(1300);
  });

  it('pays the daily reward once even under concurrent claims', async () => {
    const p = await login('Daily');
    const results = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/rewards/daily', p.token)));
    expect(results.filter((r) => r.body.claimed).length).toBe(1);
    expect(await balance(p)).toBe(1200);
  });

  it('never lets a balance go negative', async () => {
    const p = await login('Broke');
    await expect(
      t.app.get(LedgerService).applyStandalone({ userId: p.id, amount: -5000, type: 'test', description: 'x', key: `neg:${p.id}` }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await balance(p)).toBe(1000);
    const rows = await t.app.get(DataSource).query(`SELECT 1 FROM ledger_entries WHERE "idempotencyKey" = $1`, [`neg:${p.id}`]);
    expect(rows).toHaveLength(0);
  });

  it('rejects rooms for Conquer while it is in maintenance', async () => {
    const p = await login('Conqueror');
    const res = await api('POST', '/rooms', p.token, { gameSlug: 'conquer' });
    expect(res.status).toBe(503);
  });

  it('two independent players finish a Ludo match over Socket.IO with exactly-once settlement', async () => {
    const a = await login('Almaz');
    const b = await login('Bekele');
    const matchId = await startRoom('ludo', 50, [a, b]);
    expect(await balance(a)).toBe(950);

    // Duplicate submissions of one action apply once.
    let s = await state<LudoView>(matchId, a);
    const first = s.view.currentPlayerId === a.id ? a : b;
    const dupId = randomUUID();
    const acks = await Promise.all([act(first, matchId, { type: 'roll' }, dupId), act(first, matchId, { type: 'roll' }, dupId)]);
    expect(acks.every((x) => x.ok)).toBe(true);
    expect((await state(matchId, a)).version).toBe(s.version + 1);

    // Out-of-turn actions are rejected by the server.
    s = await state<LudoView>(matchId, a);
    const idle = s.view.currentPlayerId === a.id ? b : a;
    expect(await act(idle, matchId, { type: 'roll' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });

    for (let i = 0; i < 4000; i++) {
      s = await state<LudoView>(matchId, a);
      if (s.status !== 'active') break;
      const current = s.view.currentPlayerId === a.id ? a : b;
      const view = current === a ? s.view : (await state<LudoView>(matchId, b)).view;
      const action = view.phase === 'roll' ? { type: 'roll' } : { type: 'move', token: view.legalTokens[view.legalTokens.length - 1] };
      const ack = await act(current, matchId, action);
      expect(ack).toEqual({ ok: true });
    }
    expect(s.status).toBe('finished');
    const winner = s.view.winnerId === a.id ? a : b;
    const loser = winner === a ? b : a;
    expect(await balance(winner)).toBe(1050);
    expect(await balance(loser)).toBe(950);
    expect(await act(winner, matchId, { type: 'roll' })).toMatchObject({ ok: false, code: 'GAME_OVER' });

    const summary = (await api('GET', `/matches/${matchId}`, a.token)).body;
    expect(summary.status).toBe('finished');
    expect(summary.players.find((p: { userId: string }) => p.userId === winner.id)).toMatchObject({ placement: 1, outcome: 'win', pointsDelta: 50 });
    const stats = (await api('GET', '/me/stats', winner.token)).body;
    expect(stats).toEqual([expect.objectContaining({ gameSlug: 'ludo', played: 1, won: 1 })]);
    const payouts = await t.app.get(DataSource).query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE "matchId" = $1 AND type = 'payout'`, [matchId]);
    expect(payouts[0].n).toBe(1);
    expect(a.states.length).toBeGreaterThan(5);
    expect(b.states.length).toBeGreaterThan(5);
    const board = (await api('GET', '/leaderboard?game=ludo')).body;
    expect(board[0]).toMatchObject({ userId: winner.id, won: 1 });
    const events = (await api('GET', `/matches/${matchId}/events`, a.token)).body;
    expect(events[0].seq).toBe(1);
  });

  it('keeps poker hole cards private and settles chips back to points', async () => {
    const a = await login('Hana');
    const b = await login('Dawit');
    const matchId = await startRoom('poker', 500, [a, b]);
    const ds = t.app.get(DataSource);
    const [{ state: internal }] = await ds.query(`SELECT state FROM matches WHERE id = $1`, [matchId]);
    const holeOf = (id: string): string[] => internal.players.find((p: { playerId: string }) => p.playerId === id).hole;

    const viewA = (await state<PokerView>(matchId, a)).view;
    expect(viewA.players.find((p) => p.playerId === a.id)!.hole).toEqual(holeOf(a.id));
    expect(viewA.players.find((p) => p.playerId === b.id)!.hole).toEqual(['??', '??']);
    for (const payload of a.states) for (const card of holeOf(b.id)) expect(JSON.stringify(payload)).not.toContain(`"${card}"`);
    for (const payload of b.states) for (const card of holeOf(a.id)) expect(JSON.stringify(payload)).not.toContain(`"${card}"`);
    expect(JSON.stringify(viewA)).not.toContain('"deck"');

    const current = viewA.currentPlayerId === a.id ? a : b;
    expect(await act(current, matchId, { type: 'raise', amount: 5 })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(await act(current, matchId, { type: 'fold' })).toMatchObject({ ok: true });
    const other = current === a ? b : a;
    expect((await state<PokerView>(matchId, a)).view.phase).toBe('handComplete');
    expect(await act(other, matchId, { type: 'leave' })).toMatchObject({ ok: true });
    expect((await state(matchId, a)).status).toBe('finished');
    // A 500 buy-in plays 5/10 blinds: folding the small blind costs 5; both stacks are cashed back.
    expect(await balance(current)).toBe(995);
    expect(await balance(other)).toBe(1005);
  });

  it('plays a blackjack session with a hidden dealer hole card', async () => {
    const p = await login('Lulit');
    const created = await api('POST', '/rooms', p.token, { gameSlug: 'blackjack', stake: 10 });
    expect(created.body.status).toBe('in_progress');
    const matchId = created.body.matchId;
    expect(await act(p, matchId, { type: 'bet', amount: 20 })).toMatchObject({ ok: true });
    let s = await state<BlackjackView>(matchId, p);
    if (s.view.phase === 'playerTurn') {
      expect(s.view.dealer.cards[1]).toBe('??');
      const [{ state: internal }] = await t.app.get(DataSource).query(`SELECT state FROM matches WHERE id = $1`, [matchId]);
      expect(JSON.stringify(s)).not.toContain(`"${internal.dealer[1]}"`);
      expect(await act(p, matchId, { type: 'stand' })).toMatchObject({ ok: true });
      s = await state<BlackjackView>(matchId, p);
    }
    expect(s.view.phase).toBe('roundOver');
    expect(s.view.dealer.revealed).toBe(true);
    expect(await act(p, matchId, { type: 'leave' })).toMatchObject({ ok: true });
    s = await state<BlackjackView>(matchId, p);
    expect(s.status).toBe('finished');
    expect(await balance(p)).toBe(1000 + s.view.sessionNet);
  });

  it('blocks joining a table the player cannot afford', async () => {
    const host = await login('Host');
    const poor = await login('Poor');
    const room = await api('POST', '/rooms', host.token, { gameSlug: 'ludo', stake: 5000 });
    expect(room.status).toBe(400);
    const ok = await api('POST', '/rooms', host.token, { gameSlug: 'ludo', stake: 900 });
    await t.app.get(LedgerService).applyStandalone({ userId: poor.id, amount: -500, type: 'test', description: 'x', key: `drain:${poor.id}` });
    const join = await api('POST', `/rooms/${ok.body.code}/join`, poor.token);
    expect(join.body.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('recovers active matches from PostgreSQL after a restart', async () => {
    const a = await login('Selam');
    const b = await login('Yonas');
    const matchId = await startRoom('ludo', 0, [a, b]);
    const before = await state<LudoView>(matchId, a);
    for (const s of sockets) s.disconnect();
    await t.close();

    t = await startApp(DB!, { dropSchema: false });
    api = client(t.url);
    expect(await t.app.get(MatchRuntimeService).recover()).toBeGreaterThanOrEqual(1);
    const after = await state<LudoView>(matchId, a);
    expect(after.version).toBe(before.version);
    expect(after.view).toEqual(before.view);
    const current = after.view.currentPlayerId === a.id ? a : b;
    current.socket = await connect(t.url, current.token);
    sockets.push(current.socket);
    expect(await emitAck(current.socket, 'match:subscribe', { matchId })).toMatchObject({ ok: true });
    expect(await act(current, matchId, { type: 'roll' })).toMatchObject({ ok: true });
    expect((await state(matchId, a)).version).toBe(before.version + 1);
  });
});
