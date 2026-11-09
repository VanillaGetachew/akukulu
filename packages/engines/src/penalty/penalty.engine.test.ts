import { describe, expect, it } from 'vitest';
import { PENALTY_REVEAL_MS, type PenaltySide } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { penaltyEngine, type PenaltyState } from './penalty.engine';

const NOW = 1_000_000;
const rich = { a: 1000, b: 1000 };
const ctx = (now = NOW, seed = 3, balances: Record<string, number> = rich): EngineContext => ({ rng: seededRng(seed), now, balances });
const seats = [
  { playerId: 'a', seat: 0 },
  { playerId: 'b', seat: 1 },
];

function must(res: EngineResult<PenaltyState> | null) {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`${res.code}: ${res.error}`);
  return res;
}

const start = (stake = 100, seed = 3) => must(penaltyEngine.start(seats, penaltyEngine.parseConfig({}, stake), ctx(NOW, seed))).state;
const kickerId = (s: PenaltyState) => s.players[s.kicker].playerId;
const keeperId = (s: PenaltyState) => s.players[1 - s.kicker].playerId;

/** One kick. `scored` decides whether the keeper guesses wrong. */
function kick(s: PenaltyState, scored: boolean) {
  const aim: PenaltySide = 'left';
  const first = must(penaltyEngine.act(s, kickerId(s), { type: 'choose', side: aim }, ctx()));
  return must(penaltyEngine.act(first.state, keeperId(s), { type: 'choose', side: scored ? 'right' : aim }, ctx()));
}

/** Kicks until finished: `scores(id)` says whether that player's kicks go in. */
function play(state: PenaltyState, scores: (id: string, kickNumber: number) => boolean) {
  let s = state;
  const ledger: LedgerIntent[] = [];
  for (let i = 0; i < 100 && s.phase !== 'finished'; i++) {
    const r = kick(s, scores(kickerId(s), s.players.find((p) => p.playerId === kickerId(s))!.kicks.length));
    s = r.state;
    ledger.push(...r.ledger);
  }
  return { state: s, ledger };
}

describe('Penalty Shootout', () => {
  it('takes both stakes and needs exactly two players who can pay', () => {
    const res = must(penaltyEngine.start(seats, penaltyEngine.parseConfig({}, 100), ctx()));
    expect(res.ledger.map((l) => [l.playerId, l.amount, l.type])).toEqual([
      ['a', -100, 'stake'],
      ['b', -100, 'stake'],
    ]);
    expect(penaltyEngine.start([seats[0]], penaltyEngine.parseConfig({}, 0), ctx()).ok).toBe(false);
    expect(penaltyEngine.start(seats, penaltyEngine.parseConfig({}, 100), ctx(NOW, 3, { a: 99, b: 1000 })).ok).toBe(false);
  });

  it('costs nothing at a free table', () => {
    const { ledger } = play(start(0), (id) => id === 'a');
    expect(ledger).toEqual([]);
  });

  it('scores when the keeper guesses wrong and saves when right', () => {
    const s = start();
    const scored = kick(s, true).state;
    expect(scored.lastKick).toMatchObject({ seq: 1, kickerId: kickerId(s), aim: 'left', dive: 'right', goal: true });
    expect(scored.players.find((p) => p.playerId === kickerId(s))).toMatchObject({ goals: 1, kicks: ['goal'] });
    const saved = kick(scored, false).state;
    expect(saved.lastKick).toMatchObject({ seq: 2, goal: false });
    expect(saved.players.find((p) => p.playerId === kickerId(scored))).toMatchObject({ goals: 0, kicks: ['saved'] });
  });

  it('swaps kicker and keeper after each kick', () => {
    const s = start();
    const next = kick(s, true).state;
    expect(kickerId(next)).toBe(keeperId(s));
    expect(keeperId(next)).toBe(kickerId(s));
  });

  it('never shows a hidden pick to the other player', () => {
    const s = start();
    const chosen = must(penaltyEngine.act(s, kickerId(s), { type: 'choose', side: 'right' }, ctx())).state;
    const keeperView = penaltyEngine.view(chosen, keeperId(s));
    expect(keeperView).toMatchObject({ myRole: 'keeper', myChoice: null, opponentReady: true, canChoose: true });
    expect(JSON.stringify(keeperView)).not.toContain('right');
    expect(JSON.stringify(penaltyEngine.view(chosen, null))).not.toContain('right');
    expect(penaltyEngine.view(chosen, kickerId(s))).toMatchObject({ myRole: 'kicker', myChoice: 'right', canChoose: false });
  });

  it('refuses a second pick, a bad side and outsiders', () => {
    const s = start();
    const chosen = must(penaltyEngine.act(s, 'a', { type: 'choose', side: 'left' }, ctx())).state;
    expect(penaltyEngine.act(chosen, 'a', { type: 'choose', side: 'right' }, ctx())).toMatchObject({ ok: false, code: 'ALREADY_CHOSEN' });
    expect(penaltyEngine.act(s, 'a', { type: 'choose', side: 'up' }, ctx())).toMatchObject({ ok: false, code: 'BAD_SIDE' });
    expect(penaltyEngine.act(s, 'z', { type: 'choose', side: 'left' }, ctx())).toMatchObject({ ok: false, code: 'NOT_IN_MATCH' });
  });

  it('ends early once a player cannot be caught and pays the pot', () => {
    const { state, ledger } = play(start(), (id) => id === 'a');
    expect(state).toMatchObject({ phase: 'finished', winnerId: 'a', finishReason: 'score' });
    expect(state.players[0].goals).toBe(3);
    expect(state.players[0].kicks.length).toBeLessThan(5);
    expect(ledger.filter((l) => l.type === 'payout')).toEqual([expect.objectContaining({ playerId: 'a', amount: 200, key: 'payout:a' })]);
    expect(penaltyEngine.placements(state)).toEqual([
      { playerId: 'a', placement: 1, outcome: 'win' },
      { playerId: 'b', placement: 2, outcome: 'loss' },
    ]);
  });

  it('goes to sudden death when level, and only decides on equal kicks', () => {
    // Everyone scores the regular five; then b misses their sixth.
    const { state } = play(start(100, 1), (id, n) => n < 5 || id === 'a');
    expect(state.winnerId).toBe('a');
    expect(state.players[0].kicks.length).toBe(state.players[1].kicks.length);
    expect(state.players[0].kicks.length).toBe(6);
    expect(penaltyEngine.view(state, 'a').suddenDeath).toBe(true);
  });

  it('always ends: a shootout level for too long is settled by a coin toss', () => {
    const { state } = play(start(), () => true);
    expect(state.phase).toBe('finished');
    expect(state.finishReason).toBe('coin');
    expect(state.players[0].kicks.length + state.players[1].kicks.length).toBe(state.config.maxKicks);
  });

  it('gives the winner the pot when the other player leaves', () => {
    const res = must(penaltyEngine.act(start(), 'a', { type: 'leave' }, ctx()));
    expect(res.state).toMatchObject({ phase: 'finished', winnerId: 'b', finishReason: 'forfeit' });
    expect(res.ledger).toEqual([expect.objectContaining({ playerId: 'b', amount: 200 })]);
  });

  it('picks at random on a timeout, and loses a player who keeps missing', () => {
    let s = start();
    expect(penaltyEngine.tick(s, ctx(NOW + 1000))).toBeNull();
    const timed = must(penaltyEngine.tick(s, ctx(s.turnDeadline!)));
    expect(timed.state.lastKick).not.toBeNull();
    expect(timed.state.turnDeadline).toBe(s.turnDeadline! + PENALTY_REVEAL_MS + s.config.turnSeconds * 1000);
    s = timed.state;
    // b keeps answering; a never does.
    for (let i = 0; i < 2; i++) {
      s = must(penaltyEngine.act(s, 'b', { type: 'choose', side: 'center' }, ctx())).state;
      s = must(penaltyEngine.tick(s, ctx(s.turnDeadline!))).state;
    }
    expect(s).toMatchObject({ phase: 'finished', winnerId: 'b', finishReason: 'forfeit' });
  });

  it('a player who answers keeps their missed count at zero', () => {
    let s = start();
    s = must(penaltyEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.players[0].missedTurns).toBe(1);
    s = must(penaltyEngine.act(s, 'a', { type: 'choose', side: 'left' }, ctx())).state;
    expect(s.players[0].missedTurns).toBe(0);
  });
});
