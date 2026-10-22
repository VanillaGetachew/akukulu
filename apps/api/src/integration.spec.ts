/**
 * End-to-end tests against a real PostgreSQL database (Socket.IO + REST).
 * Opt-in: set TEST_DATABASE_URL (see `npm run test:integration` in the repo root).
 */
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { seededRng } from '@akukulu/engines';
import {
  GAME_SLUGS,
  HIDDEN_CARD,
  LEGACY_CONQUER_MAINTENANCE_MESSAGE,
  NO_ENGINE_MAINTENANCE_MESSAGE,
  type BlackjackView,
  type ConquerView,
  type CrazyView,
  type LudoView,
  type MatchStatePayload,
  type PokerView,
} from '@akukulu/shared';
import { GamesService } from './games/games.service';
import { MatchRuntimeService } from './matches/match-runtime.service';
import { LedgerService } from './wallet/ledger.service';
import { PokerService } from './poker/poker.service';
import { ADMIN_TELEGRAM_ID, client, connect, emitAck, initDataFor, startApp, type TestApp } from './testing/harness';

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
  const allowedDiscards = (v: ConquerView) => v.hand.filter((c) => !v.undiscardable.includes(c));
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

  it('serves exactly the five-game catalog and prunes legacy games', async () => {
    const ds = t.app.get(DataSource);
    await ds.query(`INSERT INTO games (slug, name, tagline, description, "minPlayers", "maxPlayers") VALUES ('bingo','Bingo','x','x',1,1)`);
    // A database seeded before Conquer had an engine carries the automatic "rules pending" maintenance.
    await ds.query(`UPDATE games SET maintenance = true, "maintenanceMessage" = $1, "maxPlayers" = 5 WHERE slug = 'conquer'`, [LEGACY_CONQUER_MAINTENANCE_MESSAGE]);
    // A game first seeded while its engine was not loaded yet (e.g. a restart mid-build) is lifted once the engine is there.
    await ds.query(`UPDATE games SET maintenance = true, "maintenanceMessage" = $1 WHERE slug = 'crazy'`, [NO_ENGINE_MAINTENANCE_MESSAGE]);
    await t.app.get(GamesService).syncCatalog();
    const res = await api('GET', '/games');
    expect(res.body.map((g: { slug: string }) => g.slug)).toEqual([...GAME_SLUGS]);
    const bySlug = Object.fromEntries(res.body.map((g: { slug: string }) => [g.slug, g]));
    expect(bySlug.ludo.playable).toBe(true);
    expect(bySlug.conquer).toMatchObject({ playable: true, maintenance: false, beta: false, minPlayers: 2, maxPlayers: 4 });
    expect(bySlug.crazy).toMatchObject({ playable: true, maintenance: false, minPlayers: 2, maxPlayers: 5 });
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

  /** Signs in as the configured administrator. */
  async function loginAdmin(): Promise<{ token: string }> {
    const res = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(Number(ADMIN_TELEGRAM_ID), 'Admin') });
    expect(res.body.user.isAdmin).toBe(true);
    return { token: res.body.token };
  }

  it('turns a referral into a reward that pays only after admin approval', async () => {
    const referrer = await login('Referrer');
    const code = (await api('GET', '/me', referrer.token)).body.referralCode;
    await login('Friend', { start_param: `ref_${code}` });
    expect(await balance(referrer)).toBe(1000);
    const admin = await loginAdmin();
    const pending = (await api('GET', '/admin/rewards', admin.token)).body as { id: string; userId: string; type: string; amount: number }[];
    const request = pending.find((r) => r.userId === referrer.id)!;
    expect(request).toMatchObject({ type: 'referral', amount: 300 });
    expect((await api('POST', `/admin/rewards/${request.id}/approve`, admin.token, {})).status).toBe(200);
    expect(await balance(referrer)).toBe(1300);
    expect((await api('POST', `/admin/rewards/${request.id}/approve`, admin.token, {})).body.code).toBe('ALREADY_DECIDED');
  });

  it('files one daily reward request under concurrent claims; only an admin can approve it, once', async () => {
    const p = await login('Daily');
    const results = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/rewards/daily', p.token)));
    expect(results.filter((r) => r.body.claimed).length).toBe(1);
    expect(results.find((r) => r.body.claimed)!.body.pending).toBe(true);
    expect(await balance(p)).toBe(1000);
    expect((await api('GET', '/rewards', p.token)).body).toMatchObject({ dailyAvailable: false, dailyPending: true, pendingRewards: 1 });

    const admin = await loginAdmin();
    const request = ((await api('GET', '/admin/rewards', admin.token)).body as { id: string; userId: string }[]).find((r) => r.userId === p.id)!;
    // A regular player cannot approve rewards.
    expect((await api('POST', `/admin/rewards/${request.id}/approve`, p.token, {})).status).toBe(403);
    const approvals = await Promise.all([1, 2, 3].map(() => api('POST', `/admin/rewards/${request.id}/approve`, admin.token, {})));
    expect(approvals.filter((a) => a.status === 200)).toHaveLength(1);
    expect(await balance(p)).toBe(1200);
  });

  it('lets an admin reject a reward and deposit coins manually', async () => {
    const p = await login('Depositee');
    await api('POST', '/rewards/daily', p.token);
    const admin = await loginAdmin();
    const request = ((await api('GET', '/admin/rewards', admin.token)).body as { id: string; userId: string }[]).find((r) => r.userId === p.id)!;
    expect((await api('POST', `/admin/rewards/${request.id}/reject`, admin.token, { note: 'test' })).status).toBe(200);
    expect(await balance(p)).toBe(1000);
    expect((await api('POST', `/admin/users/${p.id}/deposit`, admin.token, { amount: 2500, reason: 'Tournament prize' })).body.balance).toBe(3500);
    expect((await api('POST', `/admin/users/${p.id}/deposit`, admin.token, { amount: -5, reason: 'x' })).status).toBe(400);
    expect((await api('POST', `/admin/users/${p.id}/deposit`, p.token, { amount: 100, reason: 'self' })).status).toBe(403);
    const tx = (await api('GET', '/me/transactions', p.token)).body as { type: string; amount: number }[];
    expect(tx[0]).toMatchObject({ type: 'admin_deposit', amount: 2500 });
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

  it('plays a full 1v1 Conquer round over Socket.IO with private hands and exactly-once settlement', async () => {
    const a = await login('Tigist');
    const b = await login('Kebede');
    const matchId = await startRoom('conquer', 20, [a, b]);
    expect(await balance(a)).toBe(980);
    const ds = t.app.get(DataSource);
    const internal = async () => (await ds.query(`SELECT state FROM matches WHERE id = $1`, [matchId]))[0].state;
    const handLengths = (st: { players: { playerId: string; hand: string[] }[] }) => Object.fromEntries(st.players.map((p) => [p.playerId, p.hand.length]));

    let s = await state<ConquerView>(matchId, a);
    expect(s.view.phase).toBe('predict');
    const predictor = s.view.predictorId === a.id ? a : b;
    const other = predictor === a ? b : a;
    // The prediction is blind.
    expect((await state<ConquerView>(matchId, predictor)).view.baseCard).toBeNull();
    expect((await state<ConquerView>(matchId, other)).view.baseCard).toBeNull();
    expect(await act(other, matchId, { type: 'predict', choice: 'up' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(await act(predictor, matchId, { type: 'predict', choice: 'upDown' })).toEqual({ ok: true });

    const st = await internal();
    expect(handLengths(st)).toEqual({ [predictor.id]: 13, [other.id]: 14 });
    expect(st.stock).toHaveLength(27); // 54 cards (two printed jokers) − 27 dealt
    expect(st.stock[0]).toBe(st.baseCard);
    expect(st.wildCards).toHaveLength(2); // Up & Down picks two joker cards; printed jokers copy them
    const handOf = (id: string): string[] => st.players.find((p: { playerId: string }) => p.playerId === id).hand;
    const viewA = (await state<ConquerView>(matchId, a)).view;
    expect(viewA.hand.sort()).toEqual([...handOf(a.id)].sort());
    const leaks = (payloads: unknown[], cards: string[]) => payloads.some((p) => cards.some((c) => JSON.stringify(p).includes(`"${c}"`)));
    const secretFromA = [...handOf(b.id), ...st.stock].filter((c: string) => c !== st.baseCard && !st.wildCards.includes(c));
    expect(leaks(a.states, secretFromA)).toBe(false);

    // The starter (14 cards) opens by discarding. Simultaneous conflicting discards: exactly one is accepted.
    const first = other;
    const hand = allowedDiscards((await state<ConquerView>(matchId, first)).view);
    const racing = await Promise.all([act(first, matchId, { type: 'discard', card: hand[0] }), act(first, matchId, { type: 'discard', card: hand[1] })]);
    expect(racing.filter((r) => r.ok)).toHaveLength(1);
    expect(racing.find((r) => !r.ok)).toMatchObject({ code: 'NOT_YOUR_TURN' });
    // Duplicate submission of the predictor's draw is applied once.
    const dup = randomUUID();
    const before = (await state(matchId, a)).version;
    expect(await Promise.all([act(predictor, matchId, { type: 'drawStock' }, dup), act(predictor, matchId, { type: 'drawStock' }, dup)])).toEqual([{ ok: true }, { ok: true }]);
    expect((await state(matchId, a)).version).toBe(before + 1);
    expect(handLengths(await internal())).toEqual({ [predictor.id]: 14, [other.id]: 13 });

    // Both players draw and discard until the deck runs out and the discards are reshuffled in.
    for (let i = 0; i < 80 && (await internal()).reshuffles === 0; i++) {
      s = await state<ConquerView>(matchId, a);
      const current = s.view.currentPlayerId === a.id ? a : b;
      const mine = (await state<ConquerView>(matchId, current)).view;
      expect(await act(current, matchId, mine.phase === 'draw' ? { type: 'drawStock' } : { type: 'discard', card: allowedDiscards(mine)[0] })).toEqual({ ok: true });
    }
    const reshuffled = await internal();
    expect(reshuffled.reshuffles).toBe(1);
    expect(reshuffled.discard).toHaveLength(1);
    expect(reshuffled.stock.length).toBeGreaterThan(20);

    // The player on turn leaves: the opponent wins the round and the pot, exactly once.
    s = await state<ConquerView>(matchId, a);
    const leaver = s.view.currentPlayerId === a.id ? a : b;
    const winner = leaver === a ? b : a;
    expect(await act(leaver, matchId, { type: 'leave' })).toEqual({ ok: true });
    s = await state<ConquerView>(matchId, a);
    expect(s.view.roundResult).toMatchObject({ winnerId: winner.id, reason: 'forfeit' });
    expect(s.view.players.every((p) => p.revealedHand !== null)).toBe(true);
    const winnerId = winner.id;
    expect((await balance(a)) + (await balance(b))).toBe(2000);
    expect(await balance(winner)).toBe(1020);
    const summary = (await api('GET', `/matches/${matchId}`, a.token)).body;
    expect(summary.status).toBe('finished');
    const payouts = await ds.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE "matchId" = $1 AND type IN ('payout','refund')`, [matchId]);
    expect(payouts[0].n).toBe(winnerId ? 1 : 2);
    const stats = (await api('GET', '/me/stats', a.token)).body;
    expect(stats).toEqual([expect.objectContaining({ gameSlug: 'conquer', played: 1 })]);
  });

  it('rejects illegal Conquer actions on the server', async () => {
    const a = await login('Mekdes');
    const b = await login('Henok');
    const matchId = await startRoom('conquer', 0, [a, b]);
    const s = await state<ConquerView>(matchId, a);
    const predictor = s.view.predictorId === a.id ? a : b;
    await act(predictor, matchId, { type: 'predict', choice: 'side' });
    const first = predictor === a ? b : a;
    const view = (await state<ConquerView>(matchId, first)).view;
    // The starter may not draw on the opening turn.
    expect(await act(first, matchId, { type: 'drawStock' })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(await act(first, matchId, { type: 'discard', card: allowedDiscards(view)[0] })).toEqual({ ok: true });
    const pv = (await state<ConquerView>(matchId, predictor)).view;
    expect(await act(predictor, matchId, { type: 'discard', card: pv.hand[0] })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    // Taking the discard puts it in hand, but discarding is blocked until it is melded.
    expect(await act(predictor, matchId, { type: 'takeDiscard' })).toEqual({ ok: true });
    expect(await act(predictor, matchId, { type: 'drawStock' })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(await act(predictor, matchId, { type: 'discard', card: pv.hand[0] })).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
    // A meld that repeats a card is always invalid, whatever points the client claims.
    expect(await act(predictor, matchId, { type: 'meld', melds: [{ cards: [pv.hand[0], pv.hand[0], pv.hand[1]] }], claimedPoints: 99 })).toMatchObject({ ok: false, code: 'ILLEGAL_MELD' });
    expect(await act(predictor, matchId, { type: 'discard', card: view.hand[1] })).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
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

  it('three players finish a Crazy game over Socket.IO: private hands, server-checked plays, one payout', async () => {
    const players = [await login('Chaltu'), await login('Dawit'), await login('Eden')];
    const matchId = await startRoom('crazy', 40, players);
    for (const p of players) expect(await balance(p)).toBe(960);
    const byId = new Map(players.map((p) => [p.id, p]));

    let s = await state<CrazyView>(matchId, players[0]);
    // Everyone has 5; the starter has one extra and opens the empty pile with any card.
    expect(s.view.players.map((p) => (p.playerId === s.view.currentPlayerId ? p.handCount - 1 : p.handCount))).toEqual([5, 5, 5]);
    expect(s.view.players.every((p) => p.revealedHand === null)).toBe(true);
    expect(s.view.topCard).toBeNull();
    const first = byId.get(s.view.currentPlayerId!)!;
    const firstView = (await state<CrazyView>(matchId, first)).view;
    const illegal = firstView.hand.find((c) => !firstView.legal.play.includes(c));
    if (illegal) expect(await act(first, matchId, { type: 'play', card: illegal, suit: 'h' })).toMatchObject({ ok: false });
    const idle = players.find((p) => p !== first)!;
    expect(await act(idle, matchId, { type: 'draw' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });

    for (let i = 0; i < 3000; i++) {
      s = await state<CrazyView>(matchId, players[0]);
      if (s.status !== 'active') break;
      const current = byId.get(s.view.currentPlayerId!)!;
      const v = (await state<CrazyView>(matchId, current)).view;
      const action = v.legal.play.length
        ? { type: 'play', card: v.legal.play[0], suit: v.hand.find((c) => c !== v.legal.play[0])?.[1] ?? 'h' }
        : v.legal.draw
          ? { type: 'draw' }
          : { type: 'pass' };
      expect(await act(current, matchId, action)).toEqual({ ok: true });
    }
    expect(s.status).toBe('finished');
    const winner = byId.get(s.view.winnerId!)!;
    expect(await balance(winner)).toBe(960 + 120);
    for (const p of players) if (p !== winner) expect(await balance(p)).toBe(960);
    const payouts = await t.app.get(DataSource).query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE "matchId" = $1 AND type = 'payout'`, [matchId]);
    expect(payouts[0].n).toBe(1);
    const summary = (await api('GET', `/matches/${matchId}`, winner.token)).body;
    expect(summary.players.find((p: { userId: string }) => p.userId === winner.id)).toMatchObject({ placement: 1, outcome: 'win', pointsDelta: 80 });
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

  it('runs a poker Sit & Go: buy-ins to a prize pool, 1500 tournament chips, the winner is paid by place', async () => {
    const three = [await login('Selam'), await login('Tesfaye'), await login('Yonas')];
    const created = await api('POST', '/rooms/quick-play', three[0].token, { gameSlug: 'poker', stake: 100, config: { mode: 'tournament' } });
    expect(created.body.config).toMatchObject({ mode: 'tournament' });
    // A cash table with the same buy-in is a different table.
    const cash = await api('POST', '/rooms/quick-play', three[1].token, { gameSlug: 'poker', stake: 100 });
    expect(cash.body.code).not.toBe(created.body.code);
    await api('POST', `/rooms/${cash.body.code}/leave`, three[1].token);
    for (const p of three.slice(1)) await api('POST', `/rooms/${created.body.code}/join`, p.token);
    let room;
    for (const p of three) room = (await api('POST', `/rooms/${created.body.code}/ready`, p.token, { ready: true })).body;
    expect(room.status).toBe('in_progress');
    for (const p of three) expect(await balance(p)).toBe(900);
    const s = await state<PokerView>(room.matchId, three[0]);
    expect(s.view.tournament).toMatchObject({ prizePool: 300, payouts: [300], entrants: 3, bigBlind: 20 });
    expect(s.view.players.every((p) => p.stack + p.totalCommitted === 1500)).toBe(true);
    // Two players leave: the last one in wins the whole pool; leaving forfeits tournament chips.
    const byId = new Map(three.map((p) => [p.id, p]));
    const stay = byId.get(s.view.currentPlayerId!)!;
    for (const p of three) if (p !== stay) await act(p, room.matchId, { type: 'leave' });
    await act(stay, room.matchId, { type: 'fold' }).catch(() => undefined);
    let final = await state<PokerView>(room.matchId, stay);
    for (let i = 0; i < 20 && final.status !== 'finished'; i++) {
      if (final.view.currentPlayerId === stay.id) await act(stay, room.matchId, { type: final.view.legal?.canCheck ? 'check' : 'fold' });
      final = await state<PokerView>(room.matchId, stay);
    }
    expect(final.status).toBe('finished');
    expect(await balance(stay)).toBe(900 + 300);
    for (const p of three) if (p !== stay) expect(await balance(p)).toBe(900);
  });

  /** Polls until `check` passes (timers in the runtime move the game on). */
  async function eventually<T>(read: () => Promise<T>, check: (v: T) => boolean, ms = 10_000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
      const v = await read();
      if (check(v) || Date.now() > until) return v;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  it('keeps permanent poker cash tables open: sit down any time, stand up with your chips, keep a hand history', async () => {
    const a = await login('Abebe');
    const b = await login('Bethel');
    const tables = (await api('GET', '/poker/tables', a.token)).body;
    expect(tables.map((x: { bigBlind: number }) => x.bigBlind)).toEqual([10, 50, 200, 1000]);
    const table = tables[0];
    expect(table).toMatchObject({ smallBlind: 5, bigBlind: 10, minBuyIn: 400, maxBuyIn: 1000, seated: 0, maxSeats: 9 });
    // Anyone can watch before sitting down.
    const watching = await state<PokerView>(table.matchId, a);
    expect(watching.view.cash).toMatchObject({ minBuyIn: 400, maxBuyIn: 1000 });
    expect(watching.view.phase).toBe('waiting');

    expect((await api('POST', `/poker/tables/${table.matchId}/sit`, a.token, { buyIn: 300 })).status).toBe(400);
    expect((await api('POST', `/poker/tables/${table.matchId}/sit`, a.token, { buyIn: 500, seat: 4 })).status).toBe(200);
    expect((await api('POST', `/poker/tables/${table.matchId}/sit`, a.token, { buyIn: 500 })).status).toBe(400);
    expect((await api('POST', `/poker/tables/${table.matchId}/sit`, b.token, { buyIn: 1000 })).status).toBe(200);
    expect(await balance(a)).toBe(500);
    expect(await balance(b)).toBe(0);

    // The first hand is dealt a moment after the second player sits.
    let s = await eventually(() => state<PokerView>(table.matchId, a), (v) => v.view.phase === 'preflop');
    expect(s.view.phase).toBe('preflop');
    const mine = s.view.players.find((p) => p.playerId === a.id)!;
    expect(mine.seat).toBe(4);
    expect(mine.hole.every((c) => c !== HIDDEN_CARD)).toBe(true);
    expect(mine.handLabel).toMatch(/High|Pair/);
    const first = s.view.currentPlayerId === a.id ? a : b;
    expect(await act(first, table.matchId, { type: 'fold' })).toMatchObject({ ok: true });

    // a stands up between hands and gets the stack back as points.
    s = await state<PokerView>(table.matchId, a);
    expect(s.view.phase).toBe('handComplete');
    const stack = s.view.players.find((p) => p.playerId === a.id)!.stack;
    expect(await act(a, table.matchId, { type: 'leave' })).toMatchObject({ ok: true });
    expect(await balance(a)).toBe(500 + stack);
    s = await state<PokerView>(table.matchId, a);
    expect(s.view.players.map((p) => p.playerId)).toEqual([b.id]);
    expect(s.status).toBe('active');
    expect((await api('GET', '/me/active', a.token)).body.matches.map((m: { id: string }) => m.id)).not.toContain(table.matchId);
    expect((await api('GET', '/poker/tables', b.token)).body[0]).toMatchObject({ seated: 1, seatedHere: true });

    // Both kept the hand; each sees only their own cards (nothing was shown down).
    const history = (await api('GET', `/poker/hands?matchId=${table.matchId}`, a.token)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ handNumber: 1, smallBlind: 5, bigBlind: 10, tableName: 'Addis 5/10' });
    const seats = new Map(history[0].players.map((p: { playerId: string }) => [p.playerId, p]));
    expect((seats.get(a.id) as { hole: string[] }).hole).toHaveLength(2);
    expect((seats.get(b.id) as { hole: unknown }).hole).toBeNull();
    expect(history[0].actions.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['fold']));
    // a can sit down again later with a fresh buy-in.
    expect((await api('POST', `/poker/tables/${table.matchId}/sit`, a.token, { buyIn: 400 })).status).toBe(200);
    expect(await balance(a)).toBe(100 + stack);
  });

  it('runs admin-scheduled poker tournaments: registration with refunds, start on time, late registration, prizes by place', async () => {
    const admin = await loginAdmin();
    const runtime = t.app.get(MatchRuntimeService);
    const poker = t.app.get(PokerService);
    const T = Date.now();
    const form = { name: 'Friday Freeroll', startsAt: new Date(T + 60_000).toISOString(), buyIn: 100, guarantee: 1000, startingStack: 1500, levelMinutes: 5, lateRegLevels: 1, maxEntrants: 20, tableSize: 2 };
    const players = [await login('Hana'), await login('Dawit'), await login('Liya'), await login('Kebede')];
    expect((await api('POST', '/admin/tournaments', players[0].token, form)).status).toBe(403);
    const created = await api('POST', '/admin/tournaments', admin.token, form);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'scheduled', prizePool: 1000, registered: 0, canRegister: true });
    const id = created.body.id;

    for (const p of players.slice(0, 3)) expect((await api('POST', `/poker/tournaments/${id}/register`, p.token)).status).toBe(200);
    expect((await api('POST', `/poker/tournaments/${id}/register`, players[0].token)).status).toBe(400);
    expect(await balance(players[0])).toBe(900);
    // Unregistering returns the buy-in; registering again takes it again.
    expect((await api('POST', `/poker/tournaments/${id}/unregister`, players[0].token)).status).toBe(200);
    expect(await balance(players[0])).toBe(1000);
    expect((await api('POST', `/poker/tournaments/${id}/register`, players[0].token)).status).toBe(200);
    const lobby = (await api('GET', '/poker/tournaments', players[0].token)).body.find((x: { id: string }) => x.id === id);
    expect(lobby).toMatchObject({ registered: 3, isRegistered: true, status: 'scheduled' });
    expect((await api('PATCH', `/admin/tournaments/${id}`, admin.token, { buyIn: 200 })).status).toBe(400);
    expect((await api('PATCH', `/admin/tournaments/${id}`, admin.token, { name: 'Friday Night Freeroll' })).body.name).toBe('Friday Night Freeroll');

    // Start time passes (the clock is frozen so the tables wait for the first deal).
    runtime.now = () => T + 120_000;
    poker.now = () => T + 120_000;
    try {
      await poker.startDueTournaments();
      const running = (await api('GET', `/poker/tournaments/${id}`, players[0].token)).body;
      expect(running).toMatchObject({ status: 'running', registered: 3, canRegister: true });
      const s = await state<PokerView>(running.matchId, players[0]);
      expect(s.view.tournament).toMatchObject({ kind: 'mtt', entrants: 3, tables: 2, prizePool: 1000, bigBlind: 20 });
      // Late registration seats a fourth player.
      expect((await api('POST', `/poker/tournaments/${id}/register`, players[3].token)).status).toBe(200);
      expect(await balance(players[3])).toBe(900);
      expect((await state<PokerView>(running.matchId, players[3])).view.tournament).toMatchObject({ entrants: 4, playersLeft: 4 });
      expect((await api('POST', `/poker/tournaments/${id}/unregister`, players[3].token)).status).toBe(400);

      // Three players leave before the first deal: they finish 4th, 3rd and 2nd; 4 entrants pay 65/35.
      for (const p of players.slice(1)) expect(await act(p, running.matchId, { type: 'leave' })).toMatchObject({ ok: true });
      const final = await state<PokerView>(running.matchId, players[0]);
      expect(final.status).toBe('finished');
      await poker.closeFinishedTournaments();
      expect((await api('GET', `/poker/tournaments/${id}`, players[0].token)).body.status).toBe('finished');
      expect(await balance(players[0])).toBe(900 + 650);
      expect(await balance(players[3])).toBe(900 + 350);
      expect(await balance(players[1])).toBe(900);
      expect(await balance(players[2])).toBe(900);
      const summary = (await api('GET', `/matches/${running.matchId}`, players[0].token)).body;
      expect(summary.players.find((p: { userId: string }) => p.userId === players[0].id)).toMatchObject({ placement: 1, outcome: 'win' });

      // A tournament nobody else joins is cancelled at its start time and the buy-in comes back.
      const lonely = (await api('POST', '/admin/tournaments', admin.token, { ...form, name: 'Lonely', startsAt: new Date(T + 90_000).toISOString() })).body;
      await api('POST', `/poker/tournaments/${lonely.id}/register`, players[1].token);
      expect(await balance(players[1])).toBe(800);
      await poker.startDueTournaments();
      expect((await api('GET', `/poker/tournaments/${lonely.id}`, players[1].token)).body.status).toBe('cancelled');
      expect(await balance(players[1])).toBe(900);
    } finally {
      runtime.now = () => Date.now();
      poker.now = () => Date.now();
    }

    // An administrator can cancel a scheduled tournament; every buy-in is returned.
    const later = (await api('POST', '/admin/tournaments', admin.token, { ...form, name: 'Later', startsAt: new Date(Date.now() + 3_600_000).toISOString() })).body;
    await api('POST', `/poker/tournaments/${later.id}/register`, players[2].token);
    expect(await balance(players[2])).toBe(800);
    expect((await api('POST', `/admin/tournaments/${later.id}/cancel`, admin.token, {})).body.status).toBe('cancelled');
    expect(await balance(players[2])).toBe(900);
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
      // A six-deck shoe can repeat cards, so compare the dealer's cards rather than searching the payload.
      expect(s.view.dealer.cards).toEqual([internal.dealer[0], '??']);
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

  it('ጆከር ለመሬት Conquer tables need twice the stake, and quick play keeps them apart', async () => {
    const host = await login('Joker');
    const guest = await login('Ground');
    // Everyone starts with 1000 points: a 600 table needs 1200 with the option on.
    expect((await api('POST', '/rooms', host.token, { gameSlug: 'conquer', stake: 600, config: { jokerToGround: true } })).body.code).toBe('INSUFFICIENT_BALANCE');
    const joker = await api('POST', '/rooms/quick-play', host.token, { gameSlug: 'conquer', stake: 400, config: { jokerToGround: true } });
    expect(joker.body.config).toMatchObject({ jokerToGround: true });
    // A plain table of the same stake is a different table.
    const plain = await api('POST', '/rooms/quick-play', guest.token, { gameSlug: 'conquer', stake: 400 });
    expect(plain.body.code).not.toBe(joker.body.code);
    await api('POST', `/rooms/${plain.body.code}/leave`, guest.token);
    const same = await api('POST', '/rooms/quick-play', guest.token, { gameSlug: 'conquer', stake: 400, config: { jokerToGround: true } });
    expect(same.body.code).toBe(joker.body.code);
    await api('POST', `/rooms/${same.body.code}/leave`, guest.token);
    // With less than twice the stake the guest cannot sit down.
    await t.app.get(LedgerService).applyStandalone({ userId: guest.id, amount: -300, type: 'test', description: 'x', key: `drain:${guest.id}` });
    expect((await api('POST', `/rooms/${joker.body.code}/join`, guest.token)).body.code).toBe('INSUFFICIENT_BALANCE');
    await api('POST', `/rooms/${joker.body.code}/leave`, host.token);

    // During a round both stakes are held, so they cannot be spent in another game.
    const a = await login('HoldA');
    const b = await login('HoldB');
    const created = await api('POST', '/rooms', a.token, { gameSlug: 'conquer', stake: 100, visibility: 'private', config: { jokerToGround: true } });
    await api('POST', `/rooms/${created.body.code}/join`, b.token);
    for (const p of [a, b]) await api('POST', `/rooms/${created.body.code}/ready`, p.token, { ready: true });
    const matchId = (await api('GET', `/rooms/${created.body.code}`, a.token)).body.matchId;
    expect(await balance(a)).toBe(800);
    expect(await balance(b)).toBe(800);
    // Giving up returns the held stakes; only the normal stake changes hands.
    expect(await act(a, matchId, { type: 'giveUp' })).toEqual({ ok: true });
    expect(await balance(a)).toBe(900);
    expect(await balance(b)).toBe(1100);
  });

  it('runs a 4-player Conquer table with two decks and ዶቤ: private hands, held stakes, the last one in takes the pot', async () => {
    const four = [await login('Abebe'), await login('Bontu'), await login('Chala'), await login('Desta')];
    const created = await api('POST', '/rooms', four[0].token, { gameSlug: 'conquer', stake: 50, visibility: 'private', config: { players: 4, dobe: true } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ maxPlayers: 4, minPlayers: 2 });
    for (const p of four.slice(1)) expect((await api('POST', `/rooms/${created.body.code}/join`, p.token)).status).toBe(200);
    for (const p of four) await api('POST', `/rooms/${created.body.code}/ready`, p.token, { ready: true });
    const matchId = (await api('GET', `/rooms/${created.body.code}`, four[0].token)).body.matchId;
    expect(matchId).toBeTruthy();
    // Stake + held stake are off every balance during the round.
    for (const p of four) expect(await balance(p)).toBe(900);
    const byId = new Map(four.map((p) => [p.id, p]));
    let s = await state<ConquerView>(matchId, four[0]);
    await act(byId.get(s.view.currentPlayerId!)!, matchId, { type: 'predict', choice: 'up' });
    s = await state<ConquerView>(matchId, four[0]);
    expect(s.view.players.map((p) => p.handCount).sort()).toEqual([13, 13, 13, 14]);
    expect(s.view.hand).toHaveLength(s.view.players[0].handCount);
    expect(s.view.config).toMatchObject({ players: 4, dobe: true });
    // Three players give up in turn: the fourth wins all four stakes, and the held stakes come back.
    for (let k = 0; k < 3; k++) {
      s = await state<ConquerView>(matchId, four[0]);
      expect(await act(byId.get(s.view.currentPlayerId!)!, matchId, { type: 'giveUp' })).toEqual({ ok: true });
    }
    s = await state<ConquerView>(matchId, four[0]);
    expect(s.view.phase).toBe('roundOver');
    const winner = byId.get(s.view.roundResult!.winnerId!)!;
    expect(await balance(winner)).toBe(1000 + 150);
    for (const p of four) if (p !== winner) expect(await balance(p)).toBe(950);
  });

  it('a 4-seat Conquer table starts with 3 players once everyone seated is ready', async () => {
    const three = [await login('Ermias'), await login('Fikir'), await login('Genet')];
    const created = await api('POST', '/rooms', three[0].token, { gameSlug: 'conquer', stake: 0, visibility: 'private', config: { players: 4 } });
    for (const p of three.slice(1)) await api('POST', `/rooms/${created.body.code}/join`, p.token);
    let room;
    for (const p of three) room = (await api('POST', `/rooms/${created.body.code}/ready`, p.token, { ready: true })).body;
    expect(room.status).toBe('in_progress');
    const s = await state<ConquerView>(room.matchId, three[0]);
    expect(s.view.players).toHaveLength(3);
    expect(s.view.config.players).toBe(4);
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

  it('restores a Conquer round mid-turn after a restart with hands and wildcards intact', async () => {
    const a = await login('Saba');
    const b = await login('Abel');
    const matchId = await startRoom('conquer', 0, [a, b]);
    let s = await state<ConquerView>(matchId, a);
    const predictor = s.view.predictorId === a.id ? a : b;
    await act(predictor, matchId, { type: 'predict', choice: 'down' });
    // The starter's opening turn (14 cards, must discard) is in progress when the server restarts.
    const first = predictor === a ? b : a;
    const before = await state<ConquerView>(matchId, first);
    expect(before.view.hand).toHaveLength(14);
    expect(before.view.phase).toBe('meld');
    for (const sock of sockets) sock.disconnect();
    await t.close();

    t = await startApp(DB!, { dropSchema: false });
    api = client(t.url);
    await t.app.get(MatchRuntimeService).recover();
    const after = await state<ConquerView>(matchId, first);
    expect(after.version).toBe(before.version);
    expect(after.view).toEqual(before.view);
    first.socket = await connect(t.url, first.token);
    sockets.push(first.socket);
    expect(await act(first, matchId, { type: 'discard', card: allowedDiscards(after.view)[0] })).toEqual({ ok: true });
    s = await state<ConquerView>(matchId, a);
    expect(s.view.currentPlayerId).toBe(predictor.id);
    expect(s.view.discardTop).toBe(allowedDiscards(after.view)[0]);
  });
});
