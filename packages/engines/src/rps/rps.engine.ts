import {
  DEFAULT_RPS_CONFIG,
  RPS_BEATS,
  RPS_HANDS,
  RPS_REVEAL_MS,
  type RpsConfig,
  type RpsHand,
  type RpsLastRound,
  type RpsPlayerStatus,
  type RpsView,
} from '@akukulu/shared';
import {
  ConfigError,
  actionType,
  asRecord,
  clone,
  fail,
  intInRange,
  ok,
  type EngineContext,
  type EngineEvent,
  type GameEngine,
  type LedgerIntent,
} from '../core';

export interface RpsPlayerState {
  playerId: string;
  seat: number;
  status: RpsPlayerStatus;
  wins: number;
  missedTurns: number;
  /** Hidden until both players have thrown. */
  hand: RpsHand | null;
}

export interface RpsState {
  config: RpsConfig;
  players: RpsPlayerState[];
  round: number;
  phase: 'choosing' | 'finished';
  turnDeadline: number | null;
  lastRound: RpsLastRound | null;
  winnerId: string | null;
  finishReason: 'score' | 'forfeit' | 'coin' | null;
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

const isHand = (value: unknown): value is RpsHand => typeof value === 'string' && (RPS_HANDS as readonly string[]).includes(value);

function finish(state: RpsState, winner: number, reason: NonNullable<RpsState['finishReason']>, out: Out) {
  state.phase = 'finished';
  state.winnerId = state.players[winner].playerId;
  state.finishReason = reason;
  state.turnDeadline = null;
  const pot = state.config.stake * state.players.length;
  if (pot > 0) {
    out.ledger.push({ playerId: state.winnerId, amount: pot, key: `payout:${state.winnerId}`, type: 'payout', description: 'Rock Paper Scissors win — pot' });
  }
  out.events.push({ type: 'game_won', playerId: state.winnerId, data: { pot, reason } });
}

function forfeit(state: RpsState, index: number, reason: string, out: Out) {
  state.players[index].status = 'forfeited';
  out.events.push({ type: 'forfeit', playerId: state.players[index].playerId, data: { reason } });
  finish(state, 1 - index, 'forfeit', out);
}

function resolveRound(state: RpsState, ctx: EngineContext, out: Out) {
  const [a, b] = state.players;
  const hands = { [a.playerId]: a.hand!, [b.playerId]: b.hand! };
  const winner = a.hand === b.hand ? null : RPS_BEATS[a.hand!] === b.hand ? 0 : 1;
  a.hand = null;
  b.hand = null;
  state.round += 1;
  if (winner !== null) state.players[winner].wins += 1;
  state.lastRound = { seq: state.round, hands, winnerId: winner === null ? null : state.players[winner].playerId };
  out.events.push({ type: 'round', data: { hands, winnerId: state.lastRound.winnerId } });

  if (winner !== null && state.players[winner].wins >= state.config.winsNeeded) {
    finish(state, winner, 'score', out);
    return;
  }
  if (state.round >= state.config.maxRounds) {
    // Whoever is ahead takes it; dead level goes to a coin toss.
    if (a.wins !== b.wins) finish(state, a.wins > b.wins ? 0 : 1, 'score', out);
    else finish(state, ctx.rng.int(2), 'coin', out);
    return;
  }
  state.turnDeadline = ctx.now + RPS_REVEAL_MS + state.config.turnSeconds * 1000;
}

export const rpsEngine: GameEngine<RpsState, RpsConfig, RpsView> = {
  slug: 'rps',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const config: RpsConfig = { ...DEFAULT_RPS_CONFIG, stake: intInRange(stake, 0, 1_000_000, 'stake') };
    if (raw.winsNeeded !== undefined) config.winsNeeded = intInRange(raw.winsNeeded, 1, 5, 'winsNeeded');
    if (config.maxRounds < config.winsNeeded * 2) throw new ConfigError('maxRounds is too low');
    return config;
  },

  playerLimits: () => ({ min: 2, max: 2 }),

  start(players, config, ctx) {
    if (players.length !== 2) return fail('BAD_PLAYER_COUNT', 'Rock Paper Scissors needs exactly 2 players');
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const out: Out = { events: [], ledger: [] };
    for (const p of ordered) {
      if (config.stake > 0) {
        if ((ctx.balances[p.playerId] ?? 0) < config.stake) return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the entry stake');
        out.ledger.push({ playerId: p.playerId, amount: -config.stake, key: `stake:${p.playerId}`, type: 'stake', description: 'Rock Paper Scissors entry stake' });
      }
    }
    const state: RpsState = {
      config,
      players: ordered.map((p) => ({ playerId: p.playerId, seat: p.seat, status: 'active', wins: 0, missedTurns: 0, hand: null })),
      round: 0,
      phase: 'choosing',
      turnDeadline: ctx.now + config.turnSeconds * 1000,
      lastRound: null,
      winnerId: null,
      finishReason: null,
    };
    out.events.push({ type: 'started' });
    return ok(state, out.events, out.ledger);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'The match has finished');
    const index = prev.players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return fail('NOT_IN_MATCH', 'You are not a player in this match');
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const type = actionType(action);
    if (type === 'leave') {
      forfeit(state, index, 'Left the match', out);
      return ok(state, out.events, out.ledger);
    }
    if (type !== 'throw') return fail('UNKNOWN_ACTION', 'Unknown action');
    const hand = asRecord(action).hand;
    if (!isHand(hand)) return fail('BAD_HAND', 'Choose rock, paper or scissors');
    const player = state.players[index];
    if (player.hand !== null) return fail('ALREADY_CHOSEN', 'You have already thrown this round');
    player.hand = hand;
    player.missedTurns = 0;
    if (state.players.every((p) => p.hand !== null)) resolveRound(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  tick(prev, ctx) {
    if (prev.phase === 'finished' || prev.turnDeadline === null || ctx.now < prev.turnDeadline) return null;
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (p.hand !== null) continue;
      p.missedTurns += 1;
      out.events.push({ type: 'timeout', playerId: p.playerId, data: { missedTurns: p.missedTurns } });
      if (p.missedTurns >= state.config.maxMissedTurns) {
        forfeit(state, i, 'Missed too many turns', out);
        return ok(state, out.events, out.ledger);
      }
      p.hand = RPS_HANDS[ctx.rng.int(RPS_HANDS.length)];
    }
    resolveRound(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (state) => state.turnDeadline,

  isFinished: (state) => state.phase === 'finished',

  placements(state) {
    if (state.phase !== 'finished') return null;
    return state.players
      .map((p) => ({ playerId: p.playerId, placement: p.playerId === state.winnerId ? 1 : 2, outcome: p.playerId === state.winnerId ? ('win' as const) : ('loss' as const) }))
      .sort((a, b) => a.placement - b.placement);
  },

  view(state, viewerId) {
    const me = state.players.find((p) => p.playerId === viewerId) ?? null;
    const other = me ? state.players.find((p) => p !== me)! : null;
    const finished = state.phase === 'finished';
    return {
      game: 'rps',
      config: state.config,
      phase: state.phase,
      players: state.players.map((p) => ({ playerId: p.playerId, seat: p.seat, status: p.status, wins: p.wins })),
      round: state.round,
      myHand: me?.hand ?? null,
      opponentReady: !finished && other?.hand != null,
      canThrow: !finished && me !== null && me.hand === null,
      turnDeadline: state.turnDeadline,
      lastRound: state.lastRound,
      winnerId: state.winnerId,
      finishReason: state.finishReason,
    };
  },
};
