import { describe, expect, it } from 'vitest';
import { DEFAULT_POKER_CONFIG, pokerMttPayoutPercents, pokerMttPayouts, type PokerConfig } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { describeHand } from './hand-evaluator';
import { pokerEngine, type PokerState } from './poker.engine';
import { pokerGameEngine, pokerMttEngine, type PokerMttState } from './poker-mtt';

const NOW = 9_000_000;
const rich = new Proxy({}, { get: () => 1e9 }) as Record<string, number>;
const ctx = (now = NOW, seed = 3, balances = rich): EngineContext => ({ rng: seededRng(seed), now, balances });

function expectOk<S>(res: EngineResult<S> | null): { state: S; ledger: LedgerIntent[]; events: { type: string; playerId?: string; data?: Record<string, unknown> }[] } {
  if (!res) throw new Error('expected result');
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  return res;
}

describe('Poker hand labels', () => {
  it('names the best hand in plain words', () => {
    expect(describeHand(['As', 'Kd'])).toBe('Ace High');
    expect(describeHand(['9s', '9d'])).toBe('Pair of Nines');
    expect(describeHand(['As', 'Kd', 'Ah', 'Kc', '2s'])).toBe('Two Pair, Aces & Kings');
    expect(describeHand(['7s', '7d', '7h', '2c', '2s', 'Kd'])).toBe('Full House, Sevens over Twos');
    expect(describeHand(['As', '2d', '3h', '4c', '5s', 'Kd', 'Qc'])).toBe('Straight, Five High');
    expect(describeHand(['Ts', 'Js', 'Qs', 'Ks', 'As'])).toBe('Royal Flush');
    expect(describeHand(['2h', '9h', 'Jh', '4h', 'Kh', 'Ac'])).toBe('Flush, King High');
  });

  it('shows the viewer their own hand label, never an opponent’s before showdown', () => {
    const { state } = expectOk(pokerEngine.start([{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], DEFAULT_POKER_CONFIG, ctx()));
    const v = pokerEngine.view(state, 'a');
    expect(v.players.find((p) => p.playerId === 'a')!.handLabel).toMatch(/High|Pair/);
    expect(v.players.find((p) => p.playerId === 'b')!.handLabel).toBeNull();
  });
});

describe('Poker antes', () => {
  it('takes an ante from everyone into the pot without counting it as a call', () => {
    const config: PokerConfig = { ...DEFAULT_POKER_CONFIG, buyIn: 1000, smallBlind: 10, bigBlind: 20, ante: 5 };
    const { state } = expectOk(pokerEngine.start([0, 1, 2].map((i) => ({ playerId: `p${i}`, seat: i })), config, ctx()));
    expect(state.players.map((p) => p.totalCommitted).sort((a, b) => a - b)).toEqual([5, 15, 25]);
    expect(state.currentBet).toBe(20);
    expect(pokerEngine.view(state, 'p0').pot).toBe(45);
    expect(state.handLog!.filter((l) => l.action.startsWith('ante'))).toHaveLength(3);
  });
});

describe('Poker permanent cash tables', () => {
  const config = pokerEngine.parseConfig({ permanent: true, bigBlind: 50, tableName: 'Lalibela 25/50' }, 0);
  const open = () => expectOk(pokerEngine.start([], config, ctx())).state;
  const sit = (s: PokerState, id: string, buyIn: number, now = NOW, balances = rich) => pokerEngine.act(s, id, { type: 'sit', buyIn }, ctx(now, 3, balances));

  it('opens empty with 40–100 big blind buy-ins at fixed blinds', () => {
    expect(config).toMatchObject({ permanent: true, smallBlind: 25, bigBlind: 50, minBuyIn: 2000, buyIn: 5000, maxSeats: 9 });
    const s = open();
    expect(s.phase).toBe('waiting');
    expect(pokerEngine.isFinished(s)).toBe(false);
    expect(pokerEngine.view(s, null).cash).toMatchObject({ minBuyIn: 2000, maxBuyIn: 5000, freeSeats: [0, 1, 2, 3, 4, 5, 6, 7, 8], name: 'Lalibela 25/50' });
  });

  it('checks the buy-in range and the player’s balance', () => {
    const s = open();
    expect(sit(s, 'a', 1999).ok).toBe(false);
    expect(sit(s, 'a', 5001).ok).toBe(false);
    expect(sit(s, 'a', 3000, NOW, { a: 2999 }).ok).toBe(false);
    const first = expectOk(sit(s, 'a', 3000));
    expect(first.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: -3000, key: 'buyin:a:1' })]);
    expect(sit(first.state, 'a', 3000).ok).toBe(false);
  });

  it('deals when a second player sits; a late arrival posts a big blind; standing up cashes out', () => {
    let s = expectOk(sit(open(), 'a', 5000)).state;
    s = expectOk(sit(s, 'b', 5000)).state;
    expect(s.phase).toBe('handComplete');
    s = expectOk(pokerEngine.tick(s, ctx(s.nextHandAt!))).state;
    expect(s.phase).toBe('preflop');
    // c sits down mid-hand: not dealt in now, posts a big blind next hand.
    s = expectOk(pokerEngine.act(s, 'c', { type: 'sit', buyIn: 4000, seat: 5 }, ctx())).state;
    const c = s.players.find((p) => p.playerId === 'c')!;
    expect(c).toMatchObject({ inHand: false, seat: 5, postBlind: true });
    while (s.phase !== 'handComplete') s = expectOk(pokerEngine.act(s, s.players[s.current!].playerId, { type: 'fold' }, ctx())).state;
    s = expectOk(pokerEngine.tick(s, ctx(s.nextHandAt!))).state;
    const posted = s.players.find((p) => p.playerId === 'c')!;
    expect(posted.inHand).toBe(true);
    expect(posted.totalCommitted).toBeGreaterThanOrEqual(25);
    // Everyone folds out, then a stands up between hands.
    while (s.phase !== 'handComplete') s = expectOk(pokerEngine.act(s, s.players[s.current!].playerId, { type: 'fold' }, ctx())).state;
    const stack = s.players.find((p) => p.playerId === 'a')!.stack;
    const left = expectOk(pokerEngine.act(s, 'a', { type: 'leave' }, ctx()));
    expect(left.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: stack, key: 'cashout:a:1' })]);
    expect(left.state.players.map((p) => p.playerId)).not.toContain('a');
    expect(pokerEngine.participants!(left.state)).toEqual(expect.arrayContaining(['b', 'c']));
    // a comes back: a fresh buy-in keyed by the second sit.
    const back = expectOk(sit(left.state, 'a', 2000));
    expect(back.ledger[0].key).toBe('buyin:a:2');
  });

  it('goes back to waiting when it drops below two players, and never finishes', () => {
    let s = expectOk(sit(open(), 'a', 5000)).state;
    s = expectOk(sit(s, 'b', 5000)).state;
    s = expectOk(pokerEngine.tick(s, ctx(s.nextHandAt!))).state;
    const res = expectOk(pokerEngine.act(s, 'a', { type: 'leave' }, ctx()));
    s = res.state;
    expect(s.phase).toBe('waiting');
    expect(pokerEngine.isFinished(s)).toBe(false);
    expect(s.players.map((p) => p.playerId)).toEqual(['b']);
    // a's blind went into the pot b won; a cashed out the rest.
    const cashed = res.ledger.find((l) => l.playerId === 'a')!.amount;
    expect(cashed + s.players[0].stack).toBe(10_000);
    expect(pokerEngine.deadline(s)).toBeNull();
  });

  it('keeps every chip accounted for over a long session with players coming and going', () => {
    const rng = seededRng(77);
    const c = (now: number): EngineContext => ({ rng, now, balances: rich });
    let now = NOW;
    let s = open();
    let points = 0; // points moved into the table (buy-ins minus cash-outs)
    const people = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let step = 0; step < 4000; step++) {
      now += 700;
      let res: EngineResult<PokerState> | null = null;
      const roll = rng.int(100);
      const id = people[rng.int(people.length)];
      const seated = s.players.find((p) => p.playerId === id && p.status === 'active');
      if (roll < 4 && !seated) res = pokerEngine.act(s, id, { type: 'sit', buyIn: 2000 + rng.int(3001) }, c(now));
      else if (roll < 6 && seated) res = pokerEngine.act(s, id, { type: 'leave' }, c(now));
      else if (s.current !== null) {
        const actor = s.players[s.current].playerId;
        const legal = pokerEngine.view(s, actor).legal!;
        const r = rng.int(10);
        res = pokerEngine.act(s, actor, r < 1 ? { type: 'allIn' } : r < 3 ? { type: 'fold' } : { type: legal.canCheck ? 'check' : 'call' }, c(now));
      } else if (s.nextHandAt !== null) res = pokerEngine.tick(s, c(s.nextHandAt));
      if (!res || !res.ok) continue;
      for (const l of res.ledger) points -= l.amount;
      s = res.state;
      const between = s.phase === 'handComplete' || s.phase === 'waiting';
      const chips = s.players.reduce((n, p) => n + p.stack + (between ? 0 : p.totalCommitted), 0);
      expect(chips).toBe(points);
      expect(new Set(s.players.map((p) => p.seat)).size).toBe(s.players.length);
      expect(s.players.map((p) => p.seat)).toEqual([...s.players.map((p) => p.seat)].sort((a, b) => a - b));
    }
    expect(s.handNumber).toBeGreaterThan(20);
  });

  it('records every hand for the history', () => {
    let s = expectOk(sit(open(), 'a', 5000)).state;
    s = expectOk(sit(s, 'b', 5000)).state;
    s = expectOk(pokerEngine.tick(s, ctx(s.nextHandAt!))).state;
    const res = expectOk(pokerEngine.act(s, s.players[s.current!].playerId, { type: 'fold' }, ctx()));
    const summary = res.events.find((e) => e.type === 'hand_summary')!.data!;
    expect(summary).toMatchObject({ handNumber: 1, smallBlind: 25, bigBlind: 50, tableName: 'Lalibela 25/50' });
    expect((summary.seats as unknown[]).length).toBe(2);
    expect((summary.actions as { action: string }[]).map((a) => a.action)).toEqual(['small blind 25', 'big blind 50', 'fold']);
  });
});

describe('Poker scheduled tournaments (multi-table)', () => {
  const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, seat: i }));
  const MTT = (extra: Record<string, unknown> = {}, buyIn = 100) =>
    pokerGameEngine.parseConfig({ mode: 'mtt', name: 'Sunday Million', levelMinutes: 5, ...extra }, buyIn) as PokerConfig;

  it('pays about 15% of a big field, the winner about a fifth', () => {
    const p = pokerMttPayoutPercents(100);
    expect(p).toHaveLength(15);
    expect(p[0]).toBeGreaterThan(18);
    expect(p[0]).toBeLessThan(25);
    expect(pokerMttPayouts(10_000, 100).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(pokerMttPayoutPercents(9)).toEqual([50, 30, 20]);
  });

  it('seats a big field at balanced tables and shows the tournament clock', () => {
    const config = MTT({ guarantee: 5000 });
    const s = expectOk(pokerMttEngine.start(seats(20), config, ctx())).state;
    expect(s.tables.map((t) => t.players.length).sort()).toEqual([6, 7, 7]);
    const v = pokerMttEngine.view(s, 'p0');
    expect(v.tournament).toMatchObject({ kind: 'mtt', name: 'Sunday Million', level: 1, bigBlind: 20, prizePool: 5000, entrants: 20, playersLeft: 20, tables: 3 });
    expect(v.tournament!.levelEndsAt).toBe(NOW + 5 * 60_000);
    expect(v.players.some((p) => p.playerId === 'p0')).toBe(true);
  });

  it('allows late registration only while it is open', () => {
    const s = expectOk(pokerMttEngine.start(seats(4), MTT({ lateRegLevels: 2 }), ctx())).state;
    const late = expectOk(pokerMttEngine.act(s, 'late', { type: 'register' }, ctx(NOW + 60_000))).state;
    expect(late.entrants).toBe(5);
    expect(pokerMttEngine.act(late, 'late', { type: 'register' }, ctx(NOW + 60_000)).ok).toBe(false);
    expect(pokerMttEngine.act(s, 'late', { type: 'register' }, ctx(NOW + 10 * 60_000)).ok).toBe(false);
  });

  for (const count of [3, 12, 30]) {
    it(`plays a ${count}-player tournament to one winner: places 1..${count}, balanced tables, prizes paid once`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const rng = seededRng(seed * 101 + count);
        const c = (now: number): EngineContext => ({ rng, now, balances: rich });
        let now = NOW;
        let s: PokerMttState = expectOk(pokerMttEngine.start(seats(count), MTT({ levelMinutes: 1, maxSeats: 6 }), c(now))).state;
        const ledger: LedgerIntent[] = [];
        let steps = 0;
        while (!pokerMttEngine.isFinished(s)) {
          if (++steps > 300_000) throw new Error('did not terminate');
          now += 500;
          const acting = s.tables.find((t) => t.current !== null);
          let res: EngineResult<PokerMttState> | null;
          if (acting && rng.int(20) > 0) {
            const id = acting.players[acting.current!].playerId;
            const legal = pokerMttEngine.view(s, id).legal!;
            const roll = rng.int(10);
            const action = roll < 3 ? { type: 'allIn' } : roll < 5 ? { type: 'fold' } : { type: legal.canCheck ? 'check' : 'call' };
            res = pokerMttEngine.act(s, id, action, c(now));
            if (!res.ok) res = pokerMttEngine.act(s, id, { type: legal.canCheck ? 'check' : 'fold' }, c(now));
          } else {
            const d = pokerMttEngine.deadline(s);
            if (d === null) throw new Error('stuck: no deadline and nobody to act');
            now = Math.max(now, d);
            res = pokerMttEngine.tick(s, c(now));
            if (!res) continue;
          }
          const r = expectOk(res);
          ledger.push(...r.ledger);
          s = r.state;
          if (!s.finished) {
            const sizes = s.tables.map((t) => t.players.filter((p) => p.status === 'active').length);
            expect(Math.max(...sizes)).toBeLessThanOrEqual(6);
            // Chips are conserved across all tables.
            const chips = s.tables.reduce(
              (n, t) => n + t.players.reduce((m, p) => m + p.stack + (['handComplete', 'waiting'].includes(t.phase) ? 0 : p.totalCommitted), 0),
              0,
            );
            expect(chips).toBe(count * 3000);
          }
        }
        expect(Object.values(s.places).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
        const prizes = ledger.filter((l) => l.type === 'payout');
        expect(prizes.reduce((n, l) => n + l.amount, 0)).toBe(100 * count);
        expect(new Set(prizes.map((l) => l.key)).size).toBe(prizes.length);
        const placements = pokerMttEngine.placements(s)!;
        expect(placements[0]).toMatchObject({ placement: 1, outcome: 'win' });
        expect(prizes.find((l) => l.playerId === placements[0].playerId)!.amount).toBe(pokerMttPayouts(100 * count, count)[0]);
      }
    });
  }
});
