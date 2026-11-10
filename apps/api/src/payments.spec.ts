/**
 * Manual Telebirr payments and house cuts against a real PostgreSQL database.
 * Opt-in: set TEST_DATABASE_URL (see `npm run test:integration` in the repo root).
 */
import type { Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { PaymentRequestSummary } from '@akukulu/shared';
import { normalizeEthiopianPhone, normalizeReference } from './wallet/payments.service';
import { PokerService } from './poker/poker.service';
import { RoomsService } from './rooms/rooms.service';
import { ADMIN_TELEGRAM_ID, client, connect, emitAck, initDataFor, startApp, type TestApp } from './testing/harness';

const DB = process.env.TEST_DATABASE_URL;
const suite = DB ? describe : describe.skip;

jest.setTimeout(120_000);

describe('payment input rules', () => {
  it('accepts Ethiopian mobile numbers only', () => {
    expect(normalizeEthiopianPhone('0912 345 678')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('+251712345678')).toBe('+251712345678');
    expect(normalizeEthiopianPhone('251912345678')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('0812345678')).toBeNull();
    expect(normalizeEthiopianPhone('12345')).toBeNull();
  });

  it('accepts transaction IDs regardless of case', () => {
    expect(normalizeReference(' cg12ab34xy ')).toBe('CG12AB34XY');
    expect(normalizeReference('abc')).toBeNull();
    expect(normalizeReference('AB-12 34')).toBeNull();
  });
});

suite('real-money mode', () => {
  const KEY = { 'x-internal-key': 'internal-test-key', 'content-type': 'application/json' };
  const ADMIN_TWO = '999002';
  let t: TestApp;
  let api: ReturnType<typeof client>;
  let adminToken: string;
  let adminTwoToken: string;
  let accountId: string;
  let nextTelegramId = 50_000;
  let nextRef = 100_000;
  const sockets: Socket[] = [];

  async function internal(path: string, payload?: unknown) {
    const res = await fetch(`${t.url}/api/internal${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: KEY,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  async function player() {
    const telegramId = nextTelegramId++;
    const res = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(telegramId, 'Payer') });
    expect(res.status).toBe(200);
    return { telegramId: String(telegramId), token: res.body.token as string, id: res.body.user.id as string };
  }

  const balance = async (p: { token: string }) => (await api('GET', '/me', p.token)).body.balance as number;
  const decide = (id: string, decision: 'approve' | 'reject', adminTelegramId = ADMIN_TELEGRAM_ID) => internal(`/payments/${id}/${decision}`, { adminTelegramId });
  const setAccount = (phone: string, name: string, adminTelegramId = ADMIN_TELEGRAM_ID) => internal('/payments/account', { adminTelegramId, phone, name });
  const deposit = (p: { telegramId: string }, amount: number, reference = `TX${nextRef++}`, account = accountId) => internal(`/users/${p.telegramId}/payments/deposit`, { amount, reference, accountId: account });
  const withdraw = (p: { telegramId: string }, amount: number, phone = '0912345678') => internal(`/users/${p.telegramId}/payments/withdraw`, { amount, phone });
  const earnings = async () => (await api('GET', '/admin/overview', adminToken)).body.houseEarnings as number;

  /** Money without the first-deposit bonus, for tests about something else. */
  async function funded(amount: number) {
    const p = await player();
    expect((await api('POST', `/admin/users/${p.id}/deposit`, adminToken, { amount, reason: 'test money' })).status).toBe(200);
    return p;
  }

  /** A two-player Ludo game that `winner` wins because the other player leaves. */
  async function playLudo(loser: { token: string }, winner: { token: string }, stake: number) {
    const created = await api('POST', '/rooms', loser.token, { gameSlug: 'ludo', stake, visibility: 'private' });
    expect(created.status).toBe(201);
    await api('POST', `/rooms/${created.body.code}/join`, winner.token);
    const room = await t.app.get(RoomsService).settle(created.body.code);
    expect(room.status).toBe('in_progress');
    const socket = await connect(t.url, loser.token);
    sockets.push(socket);
    expect(await emitAck(socket, 'match:action', { matchId: room.matchId, clientActionId: `leave-${created.body.code}`, action: { type: 'leave' } })).toMatchObject({ ok: true });
  }

  beforeAll(async () => {
    t = await startApp(DB!, { dropSchema: true, env: { PAYMENTS_ENABLED: 'true', ADMIN_TELEGRAM_IDS: `${ADMIN_TELEGRAM_ID},${ADMIN_TWO}` } });
    api = client(t.url);
    adminToken = (await api('POST', '/auth/telegram', undefined, { initData: initDataFor(Number(ADMIN_TELEGRAM_ID), 'Admin') })).body.token;
    adminTwoToken = (await api('POST', '/auth/telegram', undefined, { initData: initDataFor(Number(ADMIN_TWO), 'AdminTwo') })).body.token;
    accountId = (await setAccount('0911111111', 'First Admin')).body.id;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await t.close();
  });

  afterEach(() => {
    t.app.get(PokerService).now = () => Date.now();
  });

  it('gives new players no free money', async () => {
    const p = await player();
    expect(await balance(p)).toBe(0);
    expect((await api('POST', '/rewards/daily', p.token)).body.claimed).toBe(false);
    expect(await balance(p)).toBe(0);
  });

  it('credits a deposit only after approval, and only once', async () => {
    const p = await player();
    const req = await deposit(p, 500);
    expect(req.body).toMatchObject({ status: 'pending', amount: 500, kind: 'deposit' });
    expect(await balance(p)).toBe(0);
    const results = await Promise.all([1, 2, 3].map(() => decide(req.body.id, 'approve')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.code === 'ALREADY_DECIDED')).toHaveLength(2);
    expect(await balance(p)).toBe(1000); // 500 plus the first-deposit bonus, once
  });

  it('adds nothing when a deposit is rejected, and allows the ID to be resubmitted', async () => {
    const p = await player();
    const first = await deposit(p, 200, 'RETRY12345');
    expect((await decide(first.body.id, 'reject')).body.status).toBe('rejected');
    expect(await balance(p)).toBe(0);
    expect((await deposit(p, 200, 'retry12345')).status).toBe(200);
  });

  it('refuses a transaction ID already used, even by another player or in other case', async () => {
    const [a, b] = [await player(), await player()];
    await decide((await deposit(a, 300, 'SAMEID1234')).body.id, 'approve');
    expect((await deposit(b, 300, 'sameid1234')).body.code).toBe('DUPLICATE_REFERENCE');
    const racing = await Promise.all([deposit(a, 100, 'RACEID1234'), deposit(b, 100, 'RACEID1234')]);
    expect(racing.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('holds a withdrawal straight away and keeps it when approved', async () => {
    const p = await funded(1000);
    const req = await withdraw(p, 400);
    expect(req.body).toMatchObject({ status: 'pending', phone: '+251912345678', balance: 600 });
    expect(await balance(p)).toBe(600);
    expect((await decide(req.body.id, 'approve')).status).toBe(200);
    expect(await balance(p)).toBe(600);
  });

  it('returns a rejected withdrawal exactly once', async () => {
    const p = await funded(1000);
    const req = await withdraw(p, 400);
    const results = await Promise.all([1, 2, 3].map(() => decide(req.body.id, 'reject')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balance(p)).toBe(1000);
  });

  it('never pays out more than the balance', async () => {
    const p = await funded(100);
    expect((await withdraw(p, 101)).body.code).toBe('INSUFFICIENT_BALANCE');
    const racing = await Promise.all([1, 2, 3, 4].map(() => withdraw(p, 100)));
    expect(racing.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balance(p)).toBe(0);
    const pending = (await internal(`/payments/pending/${ADMIN_TELEGRAM_ID}`)).body as { telegramId: string }[];
    expect(pending.filter((r) => r.telegramId === p.telegramId)).toHaveLength(1);
  });

  it('rejects bad input and non-admins', async () => {
    const p = await player();
    expect((await deposit(p, 10)).body.code).toBe('BAD_AMOUNT');
    expect((await deposit(p, 100.5)).body.code).toBe('BAD_AMOUNT');
    expect((await deposit(p, 100, 'x')).body.code).toBe('BAD_REFERENCE');
    expect((await withdraw(p, 100, '123')).body.code).toBe('BAD_PHONE');
    const req = await deposit(p, 100);
    expect((await decide(req.body.id, 'approve', p.telegramId)).status).toBe(403);
    expect((await internal(`/payments/pending/${p.telegramId}`)).status).toBe(403);
    expect((await setAccount('0922222222', 'Sneaky', p.telegramId)).status).toBe(403);
    expect((await api('GET', '/admin/payments', p.token)).status).toBe(403);
    expect((await api('POST', `/admin/payments/${req.body.id}/approve`, p.token, {})).status).toBe(403);
    expect(await balance(p)).toBe(0);
  });

  it('keeps one number at a time and sends requests to whoever set it', async () => {
    const shown = (await internal(`/users/${(await player()).telegramId}/payments/deposit/start`, { amount: 100 })).body;
    expect(shown).toMatchObject({ phone: '+251911111111', name: 'First Admin', telegramId: ADMIN_TELEGRAM_ID });

    const p = await player();
    const started = (await internal(`/users/${p.telegramId}/payments/deposit/start`, { amount: 100 })).body;

    const socket = await connect(t.url, adminTwoToken);
    sockets.push(socket);
    const popups: PaymentRequestSummary[] = [];
    socket.on('payment:request', (r: PaymentRequestSummary) => popups.push(r));

    const changed = await setAccount('0733333333', 'Second Admin', ADMIN_TWO);
    expect(changed.body).toMatchObject({ phone: '+251733333333', telegramId: ADMIN_TWO });
    expect((await internal('/payments/account')).body.account.id).toBe(changed.body.id);

    // Someone shown the old number before the change still goes to its owner.
    const old = await deposit(p, 100, undefined, started.id);
    expect(old.body.account.telegramId).toBe(ADMIN_TELEGRAM_ID);

    const q = await player();
    const fresh = await internal(`/users/${q.telegramId}/payments/deposit/start`, { amount: 100 });
    const current = await deposit(q, 100, undefined, fresh.body.id);
    expect(current.body.account.phone).toBe('+251733333333');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(popups.map((r) => r.id)).toEqual([current.body.id]);

    const mine = (await api('GET', '/admin/payments?mine=1', adminTwoToken)).body as { id: string }[];
    expect(mine.map((r) => r.id)).toEqual([current.body.id]);
    const all = (await api('GET', '/admin/payments', adminToken)).body as { id: string }[];
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining([old.body.id, current.body.id]));

    // Approving from the web app credits the player.
    expect((await api('POST', `/admin/payments/${current.body.id}/approve`, adminTwoToken, {})).status).toBe(200);
    expect(await balance(q)).toBe(200);

    accountId = (await setAccount('0911111111', 'First Admin')).body.id;
  });

  it('never lets an admin decide their own request', async () => {
    const self = { telegramId: ADMIN_TWO, token: adminTwoToken };
    const req = await deposit(self, 100);
    expect((await decide(req.body.id, 'approve', ADMIN_TWO)).status).toBe(403);
    expect((await api('POST', `/admin/payments/${req.body.id}/approve`, adminTwoToken, {})).status).toBe(403);
    const before = await balance(self);
    expect((await decide(req.body.id, 'approve')).status).toBe(200);
    expect(await balance(self)).toBe(before + 200);
  });

  it('takes the house cut from a Ludo prize and records it', async () => {
    const before = await earnings();
    const [a, b] = [await funded(500), await funded(500)];
    await playLudo(a, b, 100);
    // Pot of 200 at 8%: the winner gets 184 and the house keeps 16.
    expect(await balance(b)).toBe(584);
    expect(await balance(a)).toBe(400);
    expect((await earnings()) - before).toBe(16);
    const revenue = (await api('GET', '/admin/revenue', adminToken)).body;
    expect(revenue.total).toBe(await earnings());
    expect(revenue.today).toBe(revenue.total);
    expect(revenue.byGame.find((g: { gameSlug: string }) => g.gameSlug === 'ludo').total).toBeGreaterThanOrEqual(16);
    expect(revenue.bySource[0]).toMatchObject({ source: 'Prizes in the other games' });
    expect(revenue.daily[0].total).toBe(revenue.total);
    expect(revenue.net).toBe(revenue.total - revenue.bonusesPaid - revenue.referralsPaid);
    expect(revenue.deposits).toBeGreaterThan(0);
    expect((await api('GET', '/admin/revenue', a.token)).status).toBe(403);
    const tx = (await api('GET', '/me/transactions', b.token)).body as { type: string; description: string }[];
    expect(tx.find((r) => r.type === 'payout')!.description).toContain('after 8% house cut');
  });

  it('takes the house cut from a Penalty Shootout prize, and nothing at a free table', async () => {
    const before = await earnings();
    const [a, b] = [await funded(100), await funded(100)];
    const created = await api('POST', '/rooms', a.token, { gameSlug: 'penalty', stake: 50, visibility: 'private' });
    const joined = await api('POST', `/rooms/${created.body.code}/join`, b.token);
    expect(joined.body.status).toBe('in_progress');
    const socket = await connect(t.url, a.token);
    sockets.push(socket);
    expect(await emitAck(socket, 'match:action', { matchId: joined.body.matchId, clientActionId: 'pk-leave', action: { type: 'leave' } })).toMatchObject({ ok: true });
    // Pot of 100 at 10%.
    expect(await balance(b)).toBe(140);
    expect((await earnings()) - before).toBe(10);

    const free = await api('POST', '/rooms', a.token, { gameSlug: 'penalty', stake: 0, visibility: 'private' });
    const started = await api('POST', `/rooms/${free.body.code}/join`, b.token);
    expect(await emitAck(socket, 'match:action', { matchId: started.body.matchId, clientActionId: 'pk-leave-2', action: { type: 'leave' } })).toMatchObject({ ok: true });
    expect(await balance(b)).toBe(140);
    expect((await earnings()) - before).toBe(10);
  });

  it('takes the house cut from Bingo and Rock Paper Scissors prizes', async () => {
    const before = await earnings();
    const [a, b, c] = [await funded(100), await funded(100), await funded(100)];
    const socket = await connect(t.url, a.token);
    const socketC = await connect(t.url, c.token);
    sockets.push(socket, socketC);

    const bingo = await api('POST', '/rooms', a.token, { gameSlug: 'bingo', stake: 50, visibility: 'private', maxPlayers: 3 });
    await api('POST', `/rooms/${bingo.body.code}/join`, b.token);
    const started = await api('POST', `/rooms/${bingo.body.code}/join`, c.token);
    expect(started.body.status).toBe('in_progress');
    // Two leave; their card price stays in, and the last player takes the pot of 150 at 10%.
    expect(await emitAck(socket, 'match:action', { matchId: started.body.matchId, clientActionId: 'bg-leave-a', action: { type: 'leave' } })).toMatchObject({ ok: true });
    expect(await balance(b)).toBe(50);
    expect(await emitAck(socketC, 'match:action', { matchId: started.body.matchId, clientActionId: 'bg-leave-c', action: { type: 'leave' } })).toMatchObject({ ok: true });
    expect(await balance(b)).toBe(50 + 150 - 15);
    expect((await earnings()) - before).toBe(15);

    const rps = await api('POST', '/rooms', a.token, { gameSlug: 'rps', stake: 50, visibility: 'private' });
    const joined = await api('POST', `/rooms/${rps.body.code}/join`, c.token);
    expect(joined.body.status).toBe('in_progress');
    expect(await emitAck(socket, 'match:action', { matchId: joined.body.matchId, clientActionId: 'rps-leave', action: { type: 'leave' } })).toMatchObject({ ok: true });
    // Pot of 100 at 10%.
    expect(await balance(c)).toBe(50 - 50 + 90);
    expect((await earnings()) - before).toBe(25);
  });

  it('sends money between players, keeps a 2% fee, and never sends twice', async () => {
    const before = await earnings();
    const [a, b] = [await funded(1000), await funded(100)];
    const ds = t.app.get(DataSource);
    await ds.query(`UPDATE users SET phone = '+251911000111', username = 'Receiver_One' WHERE id = $1`, [b.id]);

    // Found by local number, international number or username; the fee is shown first.
    for (const to of ['0911000111', '+251 911 000 111', '@receiver_one']) {
      const preview = await api('POST', '/me/transfer/preview', a.token, { to, amount: 250 });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ recipientId: b.id, amount: 250, fee: 5, receives: 245 });
    }
    expect(await balance(a)).toBe(1000);
    expect((await api('POST', '/me/transfer/preview', a.token, { to: '0999999999', amount: 250 })).status).toBe(404);
    expect((await api('POST', '/me/transfer/preview', a.token, { to: '0911000111', amount: 5 })).status).toBe(400);
    expect((await api('POST', '/me/transfer/preview', a.token, { to: '0911000111', amount: 1001 })).body.code).toBe('INSUFFICIENT_BALANCE');
    expect((await api('POST', '/me/transfer/preview', b.token, { to: '0911000111', amount: 50 })).body.code).toBe('SELF_TRANSFER');

    const requestId = randomUUID();
    const sent = await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 250, requestId });
    expect(sent.body).toMatchObject({ amount: 250, fee: 5, receives: 245, balance: 750 });
    // A second tap with the same id changes nothing.
    const again = await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 250, requestId });
    expect(again.body.balance).toBe(750);
    expect(await balance(a)).toBe(750);
    expect(await balance(b)).toBe(345);
    expect((await earnings()) - before).toBe(5);

    // The smallest transfer still pays the 1 ETB minimum fee.
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 10, requestId: randomUUID() })).body).toMatchObject({ fee: 1, receives: 9, balance: 740 });
    expect((await earnings()) - before).toBe(6);

    // Not more than you have, not to yourself, not to nobody, and not without a proper id.
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 741, requestId: randomUUID() })).body.code).toBe('INSUFFICIENT_BALANCE');
    expect((await api('POST', '/me/transfer', a.token, { recipientId: a.id, amount: 50, requestId: randomUUID() })).body.code).toBe('SELF_TRANSFER');
    expect((await api('POST', '/me/transfer', a.token, { recipientId: randomUUID(), amount: 50, requestId: randomUUID() })).status).toBe(404);
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 50, requestId: 'x' })).status).toBe(400);
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 50.5, requestId: randomUUID() })).status).toBe(400);
    expect(await balance(a)).toBe(740);

    // Two transfers at once cannot spend the same money.
    const both = await Promise.all([1, 2].map(() => api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 500, requestId: randomUUID() })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await balance(a)).toBe(240);
    expect(await balance(b)).toBe(354 + 490);

    // Bonus money has to be wagered before it can be sent on.
    await ds.query(`UPDATE users SET "bonusLocked" = 200, "bonusWagerLeft" = 1000 WHERE id = $1`, [a.id]);
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 100, requestId: randomUUID() })).body.code).toBe('BONUS_LOCKED');
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 40, requestId: randomUUID() })).status).toBe(200);
    await ds.query(`UPDATE users SET "bonusLocked" = 0, "bonusWagerLeft" = 0 WHERE id = $1`, [a.id]);

    // A banned player can neither send nor receive.
    await ds.query(`UPDATE users SET "isBanned" = true WHERE id = $1`, [b.id]);
    expect((await api('POST', '/me/transfer/preview', a.token, { to: '0911000111', amount: 50 })).status).toBe(404);
    expect((await api('POST', '/me/transfer', a.token, { recipientId: b.id, amount: 50, requestId: randomUUID() })).status).toBe(404);
    expect(await balance(a)).toBe(200);

    const history = (await api('GET', '/me/transactions?limit=5', a.token)).body as { type: string; description: string; amount: number }[];
    expect(history[0]).toMatchObject({ type: 'transfer_out', amount: -40 });
    expect(history[0].description).toContain('Sent to');
    const revenue = (await api('GET', '/admin/revenue', adminToken)).body;
    expect(revenue.bySource.some((s: { source: string }) => s.source === 'Transfer fees')).toBe(true);
  });

  it('gives the first deposit a capped bonus that unlocks after wagering', async () => {
    const p = await player();
    const first = await decide((await deposit(p, 200)).body.id, 'approve');
    expect(first.body.bonus).toBe(200);
    expect(await balance(p)).toBe(400);
    const me = (await api('GET', '/me', p.token)).body;
    expect(me).toMatchObject({ bonusLocked: 200, bonusWagerLeft: 1000 });
    // The deposit can leave, the bonus cannot.
    expect((await withdraw(p, 201)).body.code).toBe('BONUS_LOCKED');
    const out = await withdraw(p, 200);
    expect(out.status).toBe(200);
    await decide(out.body.id, 'reject');
    // A second deposit earns nothing more.
    const second = await decide((await deposit(p, 200)).body.id, 'approve');
    expect(second.body.bonus).toBeUndefined();
    expect(await balance(p)).toBe(600);

    const big = await player();
    const capped = await decide((await deposit(big, 5000)).body.id, 'approve');
    expect(capped.body.bonus).toBe(1000);
    expect(await balance(big)).toBe(6000);
  });

  it('unlocks the bonus once enough has been wagered', async () => {
    const p = await player();
    await decide((await deposit(p, 100)).body.id, 'approve');
    const rival = await funded(1000);
    for (let i = 0; i < 2; i++) await playLudo(rival, p, 100);
    expect((await api('GET', '/me', p.token)).body).toMatchObject({ bonusLocked: 100, bonusWagerLeft: 300 });
    for (let i = 0; i < 3; i++) await playLudo(rival, p, 100);
    expect((await api('GET', '/me', p.token)).body).toMatchObject({ bonusLocked: 0, bonusWagerLeft: 0 });
  });

  it('frees the next deposit from a bonus that was played and lost', async () => {
    const p = await player();
    await decide((await deposit(p, 100)).body.id, 'approve');
    const rival = await funded(1000);
    await playLudo(p, rival, 200);
    expect(await balance(p)).toBe(0);
    await decide((await deposit(p, 100)).body.id, 'approve');
    expect((await api('GET', '/me', p.token)).body).toMatchObject({ balance: 100, bonusLocked: 0 });
    expect((await withdraw(p, 100)).status).toBe(200);
  });

  it('pays the inviter 5 ETB once, when the friend has wagered 100 ETB', async () => {
    const inviter = await player();
    const code = (await api('GET', '/me', inviter.token)).body.referralCode;
    const friendId = nextTelegramId++;
    const res = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(friendId, 'Friend', { start_param: `ref_${code}` }) });
    const friend = { token: res.body.token as string, id: res.body.user.id as string };
    expect(res.body.user.balance).toBe(0);
    expect(await balance(inviter)).toBe(0);
    await api('POST', `/admin/users/${friend.id}/deposit`, adminToken, { amount: 1000, reason: 'test money' });
    const rival = await funded(1000);
    await playLudo(friend, rival, 99);
    expect(await balance(inviter)).toBe(0);
    await playLudo(friend, rival, 50);
    expect(await balance(inviter)).toBe(5);
    await playLudo(friend, rival, 100);
    expect(await balance(inviter)).toBe(5);
  });

  it('schedules automatic tournaments every two hours, staggered, and refuses to run short', async () => {
    const poker = t.app.get(PokerService);
    const start = Date.UTC(2031, 0, 1, 0, 30); // 3:30am in Ethiopia
    poker.now = () => start;
    await poker.sweep();
    await poker.sweep();
    const scheduled = (await api('GET', '/poker/tournaments', adminToken)).body as { id: string; name: string; variant: string; startsAt: string; buyIn: number; minPlayers: number; guarantee: number; prizePool: number; status: string }[];
    const auto = scheduled.filter((x) => x.startsAt.startsWith('2031'));
    expect(auto.map((x) => [x.name, x.variant, x.startsAt]).sort()).toEqual([
      ["Hold'em 50", 'holdem', '2031-01-01T01:00:00.000Z'], // 4am
      ['Omaha 100', 'omaha', '2031-01-01T02:00:00.000Z'], // 5am
    ]);
    const holdem = auto.find((x) => x.variant === 'holdem')!;
    expect(holdem).toMatchObject({ minPlayers: 5, guarantee: 225, prizePool: 225 });

    // Four of five register: at the start it is cancelled and everyone is refunded.
    const short = [await funded(100), await funded(100), await funded(100), await funded(100)];
    for (const p of short) expect((await api('POST', `/poker/tournaments/${holdem.id}/register`, p.token)).status).toBe(200);
    expect(await balance(short[0])).toBe(50);
    poker.now = () => start + 31 * 60_000;
    await poker.sweep();
    expect((await api('GET', `/poker/tournaments/${holdem.id}`, short[0].token)).body.status).toBe('cancelled');
    expect(await balance(short[0])).toBe(100);

    // The Omaha one fills past the minimum: it starts, and the pool grows with the field.
    const omaha = auto.find((x) => x.variant === 'omaha')!;
    const field = await Promise.all([1, 2, 3, 4, 5, 6].map(() => funded(200)));
    for (const p of field) expect((await api('POST', `/poker/tournaments/${omaha.id}/register`, p.token)).status).toBe(200);
    expect((await api('GET', `/poker/tournaments/${omaha.id}`, field[0].token)).body.prizePool).toBe(552);
    poker.now = () => start + 91 * 60_000;
    await poker.sweep();
    const running = (await api('GET', `/poker/tournaments/${omaha.id}`, field[0].token)).body;
    expect(running.status).toBe('running');
    const [match] = await t.app.get(DataSource).query(`SELECT state FROM matches WHERE id = $1`, [running.matchId]);
    expect(match.state.config).toMatchObject({ variant: 'omaha', housePercent: 8, guarantee: 460 });
  });

  it('shows tournament prizes after the house share', async () => {
    const created = await api('POST', '/admin/tournaments', adminToken, { name: 'Weekly', startsAt: new Date(Date.now() + 3_600_000).toISOString(), buyIn: 100 });
    expect(created.status).toBeLessThan(300);
    const p = await funded(500);
    expect((await api('POST', `/poker/tournaments/${created.body.id}/register`, p.token)).status).toBe(200);
    const list = (await api('GET', '/poker/tournaments', p.token)).body as { id: string; prizePool: number }[];
    expect(list.find((x) => x.id === created.body.id)!.prizePool).toBe(92);
  });

  it('requires the internal key', async () => {
    const p = await player();
    const res = await fetch(`${t.url}/api/internal/users/${p.telegramId}/payments/deposit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 100, reference: 'NOKEY12345', accountId }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});

suite('real-money mode switched off', () => {
  it('refuses payment requests and keeps free points working', async () => {
    const t = await startApp(DB!, { dropSchema: true });
    const api = client(t.url);
    const login = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(70_000, 'Off') });
    expect(login.body.user.balance).toBe(1000);
    const res = await fetch(`${t.url}/api/internal/users/70000/payments/deposit`, {
      method: 'POST',
      headers: { 'x-internal-key': 'internal-test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 100, reference: 'OFFID12345', accountId: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(403);
    await t.close();
  });
});

suite('new players sharing a phone number', () => {
  it('blocks play and payments until the number is shared, and only for accounts that need it', async () => {
    const t = await startApp(DB!, { dropSchema: true, env: { PAYMENTS_ENABLED: 'true', REQUIRE_PHONE: 'true' } });
    const api = client(t.url);
    const internal = async (path: string, payload: unknown) => {
      const res = await fetch(`${t.url}/api/internal${path}`, { method: 'POST', headers: { 'x-internal-key': 'internal-test-key', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: res.status, body: (await res.json()) as any };
    };
    const login = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(71_000, 'NewPlayer') });
    expect(login.body.user.needsPhone).toBe(true);
    const token = login.body.token as string;

    const room = await api('POST', '/rooms', token, { gameSlug: 'penalty', stake: 0, visibility: 'private' });
    expect(room.status).toBe(403);
    expect(room.body.code).toBe('PHONE_REQUIRED');
    expect((await api('POST', '/rooms/quick-play', token, { gameSlug: 'ludo', stake: 0 })).body.code).toBe('PHONE_REQUIRED');
    expect((await internal('/users/71000/payments/withdraw', { amount: 100, phone: '0912345678' })).body.code).toBe('PHONE_REQUIRED');

    expect((await internal('/users/71000/phone', { phone: 'not a number' })).body.code).toBe('BAD_PHONE');
    const saved = await internal('/users/71000/phone', { phone: '251 912 345 678' });
    expect(saved.body.profile.needsPhone).toBe(false);
    expect((await api('GET', '/me', token)).body.needsPhone).toBe(false);
    expect((await api('POST', '/rooms', token, { gameSlug: 'penalty', stake: 0, visibility: 'private' })).status).toBe(201);

    // The number stays private: it isn't in what the player's own profile or others can read.
    expect(JSON.stringify((await api('GET', '/me', token)).body)).not.toContain('912345678');

    // Accounts from before the rule are left alone.
    const old = await api('POST', '/auth/telegram', undefined, { initData: initDataFor(71_001, 'OldPlayer') });
    await t.app.get(DataSource).query(`UPDATE users SET "phoneRequired" = false WHERE "telegramId" = 71001`);
    expect((await api('GET', '/me', old.body.token)).body.needsPhone).toBe(false);
    await t.close();
  });
});
