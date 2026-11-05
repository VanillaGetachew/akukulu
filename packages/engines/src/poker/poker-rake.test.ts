import { describe, expect, it } from 'vitest';
import { DEFAULT_POKER_CONFIG, houseCutPercent, pokerRakeCap, takeRake, type PokerConfig } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { evaluateBest, evaluateOmaha } from './hand-evaluator';
import { legalPokerActions, pokerEngine, type PokerState } from './poker.engine';

const NOW = 9_000_000;
const rich = new Proxy({}, { get: () => 1e9 }) as Record<string, number>;
const ctx = (seed = 3): EngineContext => ({ rng: seededRng(seed), now: NOW, balances: rich });

type Ok<S> = { state: S; ledger: LedgerIntent[]; events: { type: string; data?: Record<string, unknown> }[] };
function must<S>(res: EngineResult<S>): Ok<S> {
  if (!res.ok) throw new Error(`${res.code}: ${res.error}`);
  return res;
}

const total = (s: PokerState) => s.players.reduce((sum, p) => sum + p.stack + p.totalCommitted, 0);
/** Once a hand is over the chips are all in the stacks. */
const stacks = (s: PokerState) => s.players.reduce((sum, p) => sum + p.stack, 0);
const onTurn = (s: PokerState) => s.players[s.current!].playerId;
const cuts = (events: { type: string; data?: Record<string, unknown> }[]) => events.filter((e) => e.type === 'house_cut').map((e) => e.data!.amount);

/** A heads-up cash table at 5/10 with both players seated and a hand dealt. */
function heads(rake?: { percent: number; cap: number }) {
  const config: PokerConfig = { ...pokerEngine.parseConfig({ permanent: true, bigBlind: 10 }, 0), ...(rake ? { rake } : {}) };
  let s = must(pokerEngine.start([], config, ctx())).state;
  s = must(pokerEngine.act(s, 'a', { type: 'sit', buyIn: 1000 }, ctx())).state;
  s = must(pokerEngine.act(s, 'b', { type: 'sit', buyIn: 1000 }, ctx())).state;
  return must(pokerEngine.tick(s, { ...ctx(), now: s.nextHandAt! })!).state;
}

/** Calls or checks until the hand ends, collecting every event. */
function checkDown(start: PokerState) {
  let s = start;
  const events: Ok<PokerState>['events'] = [];
  for (let i = 0; i < 40 && s.current !== null; i++) {
    const owed = s.currentBet - s.players[s.current].committed;
    const res = must(pokerEngine.act(s, onTurn(s), { type: owed > 0 ? 'call' : 'check' }, ctx()));
    events.push(...res.events);
    s = res.state;
  }
  return { state: s, events };
}

describe('house cut rates', () => {
  it('falls as the stake rises, and free games pay nothing', () => {
    expect([0, 10, 50, 51, 500, 501, 10000].map(houseCutPercent)).toEqual([0, 10, 10, 8, 8, 5, 5]);
  });

  it('caps poker rake by the blinds', () => {
    expect([10, 50, 200, 1000].map(pokerRakeCap)).toEqual([30, 100, 200, 1000]);
  });

  it('takes rake from contested pots only, up to the cap', () => {
    const pots = [
      { amount: 200, eligible: ['a', 'b'] },
      { amount: 50, eligible: ['a'] },
    ];
    expect(takeRake(pots, { percent: 5, cap: 30 })).toBe(10);
    expect(pots.map((p) => p.amount)).toEqual([190, 50]);
    const big = [{ amount: 10000, eligible: ['a', 'b'] }];
    expect(takeRake(big, { percent: 5, cap: 30 })).toBe(30);
    expect(big[0].amount).toBe(9970);
  });
});

describe('poker cash rake', () => {
  it('takes 5% of a pot that reaches showdown and removes exactly that from the table', () => {
    const start = heads({ percent: 5, cap: 30 });
    const before = total(start);
    const { state, events } = checkDown(start);
    expect(cuts(events)).toEqual([1]); // 5% of a 20 pot
    expect(stacks(state)).toBe(before - 1);
    expect(state.lastHand!.pots.reduce((sum, p) => sum + p.amount, 0)).toBe(19);
  });

  it('caps the rake on a big pot', () => {
    let s = heads({ percent: 5, cap: 30 });
    s = must(pokerEngine.act(s, onTurn(s), { type: 'raise', amount: 500 }, ctx())).state;
    const before = total(s);
    const { state, events } = checkDown(s);
    expect(cuts(events)).toEqual([30]);
    expect(stacks(state)).toBe(before - 30);
  });

  it('takes nothing when the hand ends before the flop', () => {
    const start = heads({ percent: 5, cap: 30 });
    const before = total(start);
    const res = must(pokerEngine.act(start, onTurn(start), { type: 'fold' }, ctx()));
    expect(cuts(res.events)).toEqual([]);
    expect(stacks(res.state)).toBe(before);
  });

  it('never rakes the uncalled part of a bet', () => {
    let s = heads({ percent: 5, cap: 1000 });
    // Call, then see the flop: the pot is 20 when the bet comes.
    s = must(pokerEngine.act(s, onTurn(s), { type: 'call' }, ctx())).state;
    s = must(pokerEngine.act(s, onTurn(s), { type: 'check' }, ctx())).state;
    expect(s.community.length).toBe(3);
    s = must(pokerEngine.act(s, onTurn(s), { type: 'bet', amount: 400 }, ctx())).state;
    const res = must(pokerEngine.act(s, onTurn(s), { type: 'fold' }, ctx()));
    expect(cuts(res.events)).toEqual([1]); // 5% of the 20 that was called, not of 420
  });

  it('does nothing without a rake setting, so free tables are unchanged', () => {
    const start = heads();
    const before = total(start);
    const { state, events } = checkDown(start);
    expect(cuts(events)).toEqual([]);
    expect(stacks(state)).toBe(before);
  });

  it('ignores a rake or house share sent by a player', () => {
    const c = pokerEngine.parseConfig({ permanent: true, bigBlind: 10, rake: { percent: 0, cap: 0 }, housePercent: 0 }, 0);
    expect(c.rake).toBeUndefined();
    expect(c.housePercent).toBeUndefined();
    const t = pokerEngine.parseConfig({ mode: 'tournament', housePercent: 99 }, 100);
    expect(t.housePercent).toBeUndefined();
  });
});

describe('Sit & Go house share', () => {
  it('pays the prize pool less the house share and reports it', () => {
    const config: PokerConfig = { ...DEFAULT_POKER_CONFIG, ...pokerEngine.parseConfig({ mode: 'tournament' }, 100), housePercent: 8 };
    let s = must(pokerEngine.start([{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], config, ctx())).state;
    expect(pokerEngine.view(s, 'a').tournament).toMatchObject({ prizePool: 184, payouts: [184] });
    const ledger: LedgerIntent[] = [];
    const events: Ok<PokerState>['events'] = [];
    // Both go all in until one is out; hands are decided by the cards, so keep dealing.
    for (let round = 0; round < 200 && !pokerEngine.isFinished(s); round++) {
      if (s.current === null) {
        const tick = pokerEngine.tick(s, { ...ctx(round + 1), now: (s.nextHandAt ?? NOW) + 1 });
        if (!tick) break;
        const r = must(tick);
        s = r.state;
        ledger.push(...r.ledger);
        events.push(...r.events);
        continue;
      }
      const me = s.players[s.current];
      const owed = s.currentBet - me.committed;
      const r = must(pokerEngine.act(s, me.playerId, owed > 0 ? { type: 'call' } : { type: 'raise', amount: me.committed + me.stack }, ctx(round + 1)));
      s = r.state;
      ledger.push(...r.ledger);
      events.push(...r.events);
    }
    expect(pokerEngine.isFinished(s)).toBe(true);
    expect(ledger.filter((l) => l.type === 'payout').map((l) => l.amount)).toEqual([184]);
    expect(cuts(events)).toEqual([16]);
  });
});

describe('Omaha', () => {
  const config: PokerConfig = { ...pokerEngine.parseConfig({ permanent: true, bigBlind: 10 }, 0), variant: 'omaha' };
  const dealt = () => {
    let s = must(pokerEngine.start([], config, ctx())).state;
    s = must(pokerEngine.act(s, 'a', { type: 'sit', buyIn: 1000 }, ctx())).state;
    s = must(pokerEngine.act(s, 'b', { type: 'sit', buyIn: 1000 }, ctx())).state;
    return must(pokerEngine.tick(s, { ...ctx(), now: s.nextHandAt! })!).state;
  };

  it('deals four cards and limits a raise to the pot', () => {
    const s = dealt();
    expect(s.players.every((p) => p.hole.length === 4)).toBe(true);
    // Small blind 5, big blind 10: calling makes the pot 20, so the most it can be raised to is 30.
    expect(legalPokerActions(s, s.current!)).toMatchObject({ maxAmount: 30 });
    expect(pokerEngine.act(s, onTurn(s), { type: 'raise', amount: 31 }, ctx()).ok).toBe(false);
    expect(pokerEngine.act(s, onTurn(s), { type: 'raise', amount: 30 }, ctx()).ok).toBe(true);
  });

  it('must use exactly two hole cards', () => {
    // Hold'em would play the board's royal flush; Omaha cannot use five board cards.
    const board = ['As', 'Ks', 'Qs', 'Js', 'Ts'] as const;
    const hole = ['2h', '3d', '7c', '9h'] as const;
    expect(evaluateBest([hole[0], hole[1], ...board]).category).toMatch(/Flush/);
    expect(evaluateOmaha([...hole], [...board]).category).not.toMatch(/Flush/);
    // Four hearts in hand and one on the board are not a flush: only two of the four count.
    expect(evaluateOmaha(['Ah', 'Kh', 'Qh', 'Jh'], ['2h', '7s', '9d', '3c', '5s']).category).not.toMatch(/Flush/);
    expect(evaluateOmaha(['Ah', 'Kh', '2c', '3c'], ['Qh', 'Jh', '9h', '3d', '5s']).category).toBe('Flush');
  });

  it('plays a hand through to showdown', () => {
    const start = dealt();
    const before = total(start);
    const { state } = checkDown(start);
    expect(state.community).toHaveLength(5);
    expect(stacks(state)).toBe(before);
    expect(state.lastHand!.showdown.every((h) => h.hole.length === 4 && h.best.length === 5)).toBe(true);
  });
});
