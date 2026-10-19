import { describe, expect, it } from 'vitest';
import { DEFAULT_POKER_CONFIG, HIDDEN_CARD, standardDeck, type PokerConfig } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { buildPots, pokerEngine, type PokerState } from './poker.engine';

const NOW = 9_000_000;
const ctx = (now = NOW, seed = 3): EngineContext => ({ rng: seededRng(seed), now, balances: new Proxy({}, { get: () => 1e9 }) });

function expectOk(res: EngineResult<PokerState> | null): { state: PokerState; ledger: LedgerIntent[] } {
  if (!res) throw new Error('expected result');
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  return { state: res.state, ledger: res.ledger };
}

/** A table whose current hand was dealt with the given stacks and button seat. */
function table(stacks: number[], button = 0, config: Partial<PokerConfig> = {}): PokerState {
  const cfg: PokerConfig = { ...DEFAULT_POKER_CONFIG, buyIn: 1000, smallBlind: 10, bigBlind: 20, ...config };
  const players = stacks.map((_, i) => ({ playerId: `p${i}`, seat: i }));
  const { state } = expectOk(pokerEngine.start(players, cfg, ctx()));
  state.phase = 'handComplete';
  state.nextHandAt = NOW;
  state.handNumber = 1;
  state.button = (button - 1 + stacks.length) % stacks.length;
  state.players.forEach((p, i) => (p.stack = stacks[i]));
  return expectOk(pokerEngine.tick(state, ctx())).state;
}

/** Replaces hole cards and stacks the deck so the board comes out as given. */
function rig(state: PokerState, holes: string[][], board: string[]) {
  const used = new Set([...holes.flat(), ...board]);
  const burns = standardDeck().filter((c) => !used.has(c)).slice(0, 3);
  state.players.forEach((p, i) => (p.hole = holes[i]));
  const sequence = [burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
  state.deck = [...sequence].reverse();
}

const act = (s: PokerState, id: string, action: Record<string, unknown>) => expectOk(pokerEngine.act(s, id, action, ctx()));
const current = (s: PokerState) => s.players[s.current!].playerId;

describe('Poker setup', () => {
  it('debits buy-ins, posts blinds and deals two hole cards each', () => {
    const res = expectOk(pokerEngine.start([{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], { ...DEFAULT_POKER_CONFIG }, ctx()));
    expect(res.ledger.map((l) => [l.playerId, l.amount])).toEqual([['a', -1000], ['b', -1000]]);
    const s = res.state;
    expect(s.players.every((p) => p.hole.length === 2)).toBe(true);
    expect(s.players.map((p) => p.totalCommitted).sort()).toEqual([10, 20]);
    expect(s.deck).toHaveLength(48);
  });

  it('rejects players who cannot cover the buy-in', () => {
    const poor: EngineContext = { rng: seededRng(1), now: NOW, balances: { a: 1000, b: 999 } };
    expect(pokerEngine.start([{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], DEFAULT_POKER_CONFIG, poor).ok).toBe(false);
  });

  it('heads-up: the button posts the small blind and acts first pre-flop, last post-flop', () => {
    let s = table([1000, 1000], 0);
    expect(s.smallBlindIndex).toBe(0);
    expect(s.bigBlindIndex).toBe(1);
    expect(current(s)).toBe('p0');
    s = act(s, 'p0', { type: 'call' }).state;
    expect(current(s)).toBe('p1'); // big blind option
    s = act(s, 'p1', { type: 'check' }).state;
    expect(s.phase).toBe('flop');
    expect(s.community).toHaveLength(3);
    expect(current(s)).toBe('p1');
  });

  it('three-handed: SB and BB follow the button and UTG acts first', () => {
    const s = table([1000, 1000, 1000], 0);
    expect([s.smallBlindIndex, s.bigBlindIndex]).toEqual([1, 2]);
    expect(current(s)).toBe('p0');
  });
});

describe('Poker betting rounds', () => {
  it('walks through pre-flop, flop, turn and river to a showdown', () => {
    let s = table([1000, 1000], 0);
    rig(s, [['As', 'Ad'], ['Ks', 'Kd']], ['2c', '7h', '9d', 'Jc', '3s']);
    s = act(s, 'p0', { type: 'call' }).state;
    s = act(s, 'p1', { type: 'check' }).state;
    for (const street of ['flop', 'turn', 'river']) {
      expect(s.phase).toBe(street);
      s = act(s, 'p1', { type: 'check' }).state;
      s = act(s, 'p0', { type: 'check' }).state;
    }
    expect(s.phase).toBe('handComplete');
    expect(s.community).toEqual(['2c', '7h', '9d', 'Jc', '3s']);
    expect(s.lastHand?.pots).toEqual([{ amount: 40, winners: ['p0'], eligible: ['p0', 'p1'] }]);
    expect(s.players.map((p) => p.stack)).toEqual([1020, 980]);
    expect(s.lastHand?.net).toEqual({ p0: 20, p1: -20 });
  });

  it('handles bet, raise, re-raise and call', () => {
    let s = table([1000, 1000, 1000], 0);
    s = act(s, 'p0', { type: 'raise', amount: 60 }).state;
    expect(s.minRaise).toBe(40);
    s = act(s, 'p1', { type: 'raise', amount: 140 }).state;
    expect(s.minRaise).toBe(80);
    s = act(s, 'p2', { type: 'fold' }).state;
    s = act(s, 'p0', { type: 'call' }).state;
    expect(s.phase).toBe('flop');
    expect(current(s)).toBe('p1');
    s = act(s, 'p1', { type: 'bet', amount: 100 }).state;
    s = act(s, 'p0', { type: 'call' }).state;
    expect(s.phase).toBe('turn');
    expect(s.players[0].totalCommitted).toBe(240);
  });

  it('rejects illegal actions', () => {
    const s = table([1000, 1000, 1000], 0);
    const err = (id: string, a: Record<string, unknown>) => pokerEngine.act(s, id, a, ctx());
    expect(err('p1', { type: 'call' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(err('p0', { type: 'check' })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(err('p0', { type: 'bet', amount: 100 })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(err('p0', { type: 'raise', amount: 30 })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(err('p0', { type: 'raise', amount: 5000 })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(err('p0', { type: 'raise', amount: 55.5 })).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(err('p0', { type: 'steal' })).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    expect(err('ghost', { type: 'fold' })).toMatchObject({ ok: false, code: 'NOT_IN_MATCH' });
    let flop = act(s, 'p0', { type: 'call' }).state;
    flop = act(flop, 'p1', { type: 'call' }).state;
    flop = act(flop, 'p2', { type: 'check' }).state;
    expect(pokerEngine.act(flop, 'p1', { type: 'bet', amount: 10 }, ctx())).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(pokerEngine.act(flop, 'p1', { type: 'call' }, ctx())).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
  });

  it('awards the pot without a showdown when everyone else folds, then starts the next hand', () => {
    let s = table([1000, 1000, 1000], 0);
    s = act(s, 'p0', { type: 'raise', amount: 100 }).state;
    s = act(s, 'p1', { type: 'fold' }).state;
    s = act(s, 'p2', { type: 'fold' }).state;
    expect(s.phase).toBe('handComplete');
    expect(s.lastHand?.wonWithoutShowdown).toBe(true);
    expect(s.players.map((p) => p.stack)).toEqual([1030, 990, 980]);
    expect(pokerEngine.view(s, 'p1').players[0].hole).toEqual([HIDDEN_CARD, HIDDEN_CARD]);
    expect(pokerEngine.tick(s, ctx(NOW + 1))).toBeNull();
    const next = expectOk(pokerEngine.tick(s, ctx(s.nextHandAt!))).state;
    expect(next.handNumber).toBe(s.handNumber + 1);
    expect(next.button).toBe(1);
    expect(next.phase).toBe('preflop');
  });

  it('does not let a short all-in raise reopen the betting', () => {
    let s = table([1000, 1000, 130], 0);
    s = act(s, 'p0', { type: 'raise', amount: 100 }).state;
    s = act(s, 'p1', { type: 'call' }).state;
    s = act(s, 'p2', { type: 'allIn' }).state;
    expect(s.currentBet).toBe(130);
    expect(current(s)).toBe('p0');
    expect(pokerEngine.view(s, 'p0').legal).toMatchObject({ canRaise: false, callAmount: 30 });
    expect(pokerEngine.act(s, 'p0', { type: 'raise', amount: 400 }, ctx())).toMatchObject({ ok: false });
    s = act(s, 'p0', { type: 'call' }).state;
    s = act(s, 'p1', { type: 'call' }).state;
    expect(s.phase).toBe('flop');
  });
});

describe('Poker all-ins, side pots and splits', () => {
  it('builds main and side pots from commitments', () => {
    const p = (id: string, totalCommitted: number, folded = false) => ({ playerId: id, totalCommitted, folded, inHand: true }) as never;
    expect(buildPots([p('a', 100), p('b', 300), p('c', 300)])).toEqual([
      { amount: 300, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
    expect(buildPots([p('a', 50, true), p('b', 200), p('c', 100)])).toEqual([
      { amount: 250, eligible: ['b', 'c'] },
      { amount: 100, eligible: ['b'] },
    ]);
  });

  it('runs the board out when everyone is all-in and pays each pot to its best eligible hand', () => {
    let s = table([100, 300, 300], 0);
    rig(s, [['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']], ['2c', '7h', '9d', 'Jc', '3s']);
    s = act(s, 'p0', { type: 'allIn' }).state;
    s = act(s, 'p1', { type: 'allIn' }).state;
    s = act(s, 'p2', { type: 'call' }).state;
    expect(s.phase).toBe('handComplete');
    expect(s.community).toHaveLength(5);
    expect(s.lastHand?.pots).toEqual([
      { amount: 300, winners: ['p0'], eligible: ['p0', 'p1', 'p2'] },
      { amount: 400, winners: ['p1'], eligible: ['p1', 'p2'] },
    ]);
    expect(s.players.map((p) => p.stack)).toEqual([300, 400, 0]);
    expect(s.players[2].status).toBe('busted');
    // Showdown cards become visible to everyone.
    expect(pokerEngine.view(s, 'p2').players[0].hole).toEqual(['As', 'Ad']);
  });

  it('splits a tied pot and gives the odd chip left of the button', () => {
    // Small blind of 5 folds, leaving an odd 45-chip pot for two tied players.
    let s = table([1000, 1000, 1000], 0, { smallBlind: 5 });
    rig(s, [['2c', '3d'], ['4h', '5c'], ['6d', '7c']], ['Ts', 'Js', 'Qs', 'Ks', 'As']);
    s = act(s, 'p0', { type: 'call' }).state;
    s = act(s, 'p1', { type: 'fold' }).state;
    s = act(s, 'p2', { type: 'check' }).state;
    for (let street = 0; street < 3; street++) {
      for (const id of ['p2', 'p0']) s = act(s, id, { type: 'check' }).state;
    }
    expect(s.lastHand?.showdown.every((x) => x.category === 'Royal Flush')).toBe(true);
    expect(s.lastHand?.pots[0]).toMatchObject({ amount: 45, winners: ['p2', 'p0'] });
    expect(s.players.map((p) => p.stack)).toEqual([1002, 995, 1003]);
  });
});

describe('Poker privacy', () => {
  it('never exposes opponents’ hole cards or the deck', () => {
    const s = table([1000, 1000, 1000], 0);
    const view = pokerEngine.view(s, 'p0');
    const json = JSON.stringify(view);
    for (const card of [...s.players[1].hole, ...s.players[2].hole, ...s.deck]) expect(json).not.toContain(`"${card}"`);
    expect(view.players[0].hole).toEqual(s.players[0].hole);
    expect(view.players[1].hole).toEqual([HIDDEN_CARD, HIDDEN_CARD]);
    expect(view).not.toHaveProperty('deck');
    const spectator = JSON.stringify(pokerEngine.view(s, null));
    for (const p of s.players) for (const c of p.hole) expect(spectator).not.toContain(`"${c}"`);
  });
});

describe('Poker timeouts and leaving', () => {
  it('auto-folds on timeout when facing a bet and auto-checks otherwise', () => {
    const s = table([1000, 1000], 0);
    const folded = expectOk(pokerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(folded.players[0].folded).toBe(true);
    expect(folded.phase).toBe('handComplete');
    let s2 = act(table([1000, 1000], 0), 'p0', { type: 'call' }).state;
    s2 = expectOk(pokerEngine.tick(s2, ctx(s2.turnDeadline!))).state;
    expect(s2.phase).toBe('flop');
  });

  it('removes and cashes out a player after too many missed turns', () => {
    const s = table([1000, 1000], 0, { maxMissedTurns: 1 });
    const r = expectOk(pokerEngine.tick(s, ctx(s.turnDeadline!)));
    expect(r.state.phase).toBe('finished');
    expect(r.ledger).toEqual([
      expect.objectContaining({ playerId: 'p0', amount: 990, key: 'cashout:p0' }),
      expect.objectContaining({ playerId: 'p1', amount: 1010, key: 'cashout:p1' }),
    ]);
    expect(pokerEngine.placements(r.state)?.map((p) => [p.playerId, p.outcome])).toEqual([['p1', 'win'], ['p0', 'loss']]);
  });

  it('folds and cashes out a player who leaves out of turn', () => {
    const r = expectOk(pokerEngine.act(table([1000, 1000, 1000], 0), 'p2', { type: 'leave' }, ctx()));
    expect(r.state.players[2]).toMatchObject({ folded: true, pendingLeave: true });
    expect(current(r.state)).toBe('p0');
    let s = act(r.state, 'p0', { type: 'fold' }).state;
    expect(s.phase).toBe('handComplete');
    expect(s.players[2].status).toBe('left');
    expect(s.players[2].finalChips).toBe(980);
    expect(pokerEngine.act(s, 'p2', { type: 'fold' }, ctx())).toMatchObject({ ok: false, code: 'NOT_ACTIVE' });
    s = expectOk(pokerEngine.tick(s, ctx(s.nextHandAt!))).state;
    expect(s.players[2].inHand).toBe(false);
  });
});

describe('Poker simulated tables', () => {
  for (const count of [2, 3, 6]) {
    it(`conserves chips and points over complete ${count}-player matches`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        const rng = seededRng(seed * 101 + count);
        const c = (now: number): EngineContext => ({ rng, now, balances: new Proxy({}, { get: () => 1e9 }) });
        const config: PokerConfig = { ...DEFAULT_POKER_CONFIG, buyIn: 400, smallBlind: 10, bigBlind: 20, maxHands: 150 };
        const players = Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, seat: i }));
        let now = NOW;
        const start = pokerEngine.start(players, config, c(now));
        if (!start.ok) throw new Error(start.error);
        let s = start.state;
        const ledger = [...start.ledger];
        let steps = 0;
        while (!pokerEngine.isFinished(s)) {
          if (++steps > 100_000) throw new Error('did not terminate');
          now += 1000;
          let res: EngineResult<PokerState> | null;
          if (s.phase === 'handComplete') {
            res = pokerEngine.tick(s, c(s.nextHandAt!));
          } else {
            const id = s.players[s.current!].playerId;
            const legal = pokerEngine.view(s, id).legal!;
            const roll = rng.int(10);
            let action: Record<string, unknown>;
            if (roll === 0) action = { type: 'fold' };
            else if (roll < 6) action = { type: legal.canCheck ? 'check' : 'call' };
            else if (roll < 9 && (legal.canBet || legal.canRaise)) {
              const amount = legal.minAmount + rng.int(Math.max(1, legal.maxAmount - legal.minAmount + 1));
              action = { type: legal.canBet ? 'bet' : 'raise', amount };
            } else action = { type: rng.int(4) === 0 ? 'allIn' : legal.canCheck ? 'check' : 'call' };
            res = pokerEngine.act(s, id, action, c(now));
            if (res.ok === false) res = pokerEngine.act(s, id, { type: legal.canCheck ? 'check' : 'fold' }, c(now));
          }
          const r = expectOk(res);
          ledger.push(...r.ledger);
          s = r.state;
          const onTable = s.players.reduce((sum, p) => sum + p.stack + (s.phase === 'handComplete' || s.phase === 'finished' ? 0 : p.totalCommitted), 0);
          const cashed = s.players.reduce((sum, p) => sum + (p.finalChips ?? 0), 0);
          expect(onTable + cashed).toBe(count * config.buyIn);
        }
        expect(ledger.reduce((sum, l) => sum + l.amount, 0)).toBe(0);
        expect(new Set(ledger.map((l) => l.key)).size).toBe(ledger.length);
        expect(pokerEngine.placements(s)).toHaveLength(count);
      }
    });
  }
});
