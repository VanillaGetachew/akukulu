import { describe, expect, it } from 'vitest';
import { RPS_REVEAL_MS, type RpsHand } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { rpsEngine, type RpsState } from './rps.engine';

const NOW = 1_000_000;
const rich = { a: 1000, b: 1000 };
const ctx = (now = NOW, seed = 3, balances: Record<string, number> = rich): EngineContext => ({ rng: seededRng(seed), now, balances });
const seats = [
  { playerId: 'a', seat: 0 },
  { playerId: 'b', seat: 1 },
];

function must(res: EngineResult<RpsState> | null) {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`${res.code}: ${res.error}`);
  return res;
}

const start = (stake = 100) => must(rpsEngine.start(seats, rpsEngine.parseConfig({}, stake), ctx())).state;

function round(s: RpsState, a: RpsHand, b: RpsHand) {
  const first = must(rpsEngine.act(s, 'a', { type: 'throw', hand: a }, ctx()));
  return must(rpsEngine.act(first.state, 'b', { type: 'throw', hand: b }, ctx()));
}

function play(state: RpsState, rounds: [RpsHand, RpsHand][]) {
  let s = state;
  const ledger: LedgerIntent[] = [];
  for (const [a, b] of rounds) {
    const r = round(s, a, b);
    s = r.state;
    ledger.push(...r.ledger);
  }
  return { state: s, ledger };
}

describe('Rock Paper Scissors', () => {
  it('takes both stakes and needs exactly two players who can pay', () => {
    const res = must(rpsEngine.start(seats, rpsEngine.parseConfig({}, 100), ctx()));
    expect(res.ledger.map((l) => [l.playerId, l.amount, l.type])).toEqual([
      ['a', -100, 'stake'],
      ['b', -100, 'stake'],
    ]);
    expect(rpsEngine.start([seats[0]], rpsEngine.parseConfig({}, 0), ctx()).ok).toBe(false);
    expect(rpsEngine.start(seats, rpsEngine.parseConfig({}, 100), ctx(NOW, 3, { a: 99, b: 1000 })).ok).toBe(false);
  });

  it('scores every pairing correctly', () => {
    const cases: [RpsHand, RpsHand, string | null][] = [
      ['rock', 'scissors', 'a'],
      ['paper', 'rock', 'a'],
      ['scissors', 'paper', 'a'],
      ['scissors', 'rock', 'b'],
      ['rock', 'paper', 'b'],
      ['paper', 'scissors', 'b'],
      ['rock', 'rock', null],
      ['paper', 'paper', null],
      ['scissors', 'scissors', null],
    ];
    for (const [a, b, winner] of cases) {
      const s = round(start(), a, b).state;
      expect(s.lastRound).toEqual({ seq: 1, hands: { a, b }, winnerId: winner });
      expect([s.players[0].wins, s.players[1].wins]).toEqual([winner === 'a' ? 1 : 0, winner === 'b' ? 1 : 0]);
    }
  });

  it('pays the whole pot to the first player to three wins, with draws replayed', () => {
    const { state, ledger } = play(start(), [
      ['rock', 'rock'],
      ['rock', 'scissors'],
      ['rock', 'paper'],
      ['paper', 'rock'],
      ['scissors', 'scissors'],
      ['scissors', 'paper'],
    ]);
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBe('a');
    expect(state.finishReason).toBe('score');
    expect(state.round).toBe(6);
    expect(ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: 200, type: 'payout' })]);
    expect(rpsEngine.placements(state)).toEqual([
      { playerId: 'a', placement: 1, outcome: 'win' },
      { playerId: 'b', placement: 2, outcome: 'loss' },
    ]);
    expect(rpsEngine.act(state, 'a', { type: 'throw', hand: 'rock' }, ctx()).ok).toBe(false);
  });

  it('costs nothing at a free table', () => {
    const { state, ledger } = play(start(0), [
      ['rock', 'scissors'],
      ['rock', 'scissors'],
      ['rock', 'scissors'],
    ]);
    expect(state.winnerId).toBe('a');
    expect(ledger).toEqual([]);
  });

  it('never shows a throw to the opponent before both are in', () => {
    const s = must(rpsEngine.act(start(), 'a', { type: 'throw', hand: 'paper' }, ctx())).state;
    const mine = rpsEngine.view(s, 'a');
    const theirs = rpsEngine.view(s, 'b');
    const watcher = rpsEngine.view(s, null);
    expect(mine.myHand).toBe('paper');
    expect(mine.canThrow).toBe(false);
    expect(theirs.myHand).toBeNull();
    expect(theirs.opponentReady).toBe(true);
    expect(theirs.canThrow).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('paper');
    expect(JSON.stringify(watcher)).not.toContain('paper');
    expect(rpsEngine.act(s, 'a', { type: 'throw', hand: 'rock' }, ctx()).ok).toBe(false);
  });

  it('rejects bad throws and strangers', () => {
    const s = start();
    expect(rpsEngine.act(s, 'a', { type: 'throw', hand: 'lizard' }, ctx()).ok).toBe(false);
    expect(rpsEngine.act(s, 'a', { type: 'dance' }, ctx()).ok).toBe(false);
    expect(rpsEngine.act(s, 'z', { type: 'throw', hand: 'rock' }, ctx()).ok).toBe(false);
  });

  it('gives the next round the reveal time on top of the turn clock', () => {
    const s = round(start(), 'rock', 'rock').state;
    expect(s.turnDeadline).toBe(NOW + RPS_REVEAL_MS + s.config.turnSeconds * 1000);
    expect(rpsEngine.tick(s, ctx(s.turnDeadline! - 1))).toBeNull();
  });

  it('throws at random for a player who runs out of time, and forfeits after three in a row', () => {
    let s = start();
    for (let i = 0; i < 2; i++) {
      s = must(rpsEngine.act(s, 'a', { type: 'throw', hand: 'rock' }, ctx())).state;
      const r = must(rpsEngine.tick(s, ctx(s.turnDeadline!, 10 + i)));
      s = r.state;
      expect(s.phase).toBe('choosing');
      expect(s.players[1].missedTurns).toBe(i + 1);
      expect(s.round).toBe(i + 1);
      // Force a state where nobody has won yet, whatever was thrown at random.
      s.players[0].wins = 0;
      s.players[1].wins = 0;
    }
    const last = must(rpsEngine.tick(s, ctx(s.turnDeadline!)));
    expect(last.state.finishReason).toBe('forfeit');
    expect(last.state.winnerId).toBe('a');
    expect(last.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: 200 })]);
  });

  it('resets the missed count when a player throws', () => {
    let s = start();
    s = must(rpsEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.players.map((p) => p.missedTurns)).toEqual([1, 1]);
    s.players[0].wins = 0;
    s.players[1].wins = 0;
    s = round(s, 'rock', 'rock').state;
    expect(s.players.map((p) => p.missedTurns)).toEqual([0, 0]);
  });

  it('gives the pot to the other player when one leaves', () => {
    const r = must(rpsEngine.act(start(), 'b', { type: 'leave' }, ctx()));
    expect(r.state.winnerId).toBe('a');
    expect(r.state.finishReason).toBe('forfeit');
    expect(r.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: 200 })]);
  });

  it('always ends: the leader wins at the round limit, and dead level is a coin toss', () => {
    const draws = Array.from({ length: 29 }, () => ['rock', 'rock'] as [RpsHand, RpsHand]);
    const ahead = play(start(), [...draws, ['rock', 'scissors']]);
    expect(ahead.state.phase).toBe('finished');
    expect(ahead.state.winnerId).toBe('a');
    expect(ahead.state.finishReason).toBe('score');
    const level = play(start(), [...draws, ['rock', 'rock']]);
    expect(level.state.phase).toBe('finished');
    expect(level.state.finishReason).toBe('coin');
    expect(level.ledger).toHaveLength(1);
    expect(level.ledger[0].amount).toBe(200);
  });

  it('clamps unusual options', () => {
    expect(() => rpsEngine.parseConfig({ winsNeeded: 99 }, 10)).toThrow();
    expect(() => rpsEngine.parseConfig({}, -5)).toThrow();
    expect(rpsEngine.parseConfig({ turnSeconds: 1, maxRounds: 1, maxMissedTurns: 99 }, 10)).toMatchObject({ turnSeconds: 10, maxRounds: 30, maxMissedTurns: 3 });
  });
});
