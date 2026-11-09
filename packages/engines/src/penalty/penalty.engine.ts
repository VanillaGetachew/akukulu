import {
  DEFAULT_PENALTY_CONFIG,
  PENALTY_REVEAL_MS,
  PENALTY_SIDES,
  type PenaltyConfig,
  type PenaltyKickResult,
  type PenaltyLastKick,
  type PenaltyPlayerStatus,
  type PenaltySide,
  type PenaltyView,
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

export interface PenaltyPlayerState {
  playerId: string;
  seat: number;
  status: PenaltyPlayerStatus;
  goals: number;
  kicks: PenaltyKickResult[];
  missedTurns: number;
  /** Hidden until both players have picked. */
  choice: PenaltySide | null;
}

export interface PenaltyState {
  config: PenaltyConfig;
  players: PenaltyPlayerState[];
  kicker: number;
  phase: 'choosing' | 'finished';
  turnDeadline: number | null;
  lastKick: PenaltyLastKick | null;
  winnerId: string | null;
  finishReason: 'score' | 'forfeit' | 'coin' | null;
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

const isSide = (value: unknown): value is PenaltySide => typeof value === 'string' && (PENALTY_SIDES as readonly string[]).includes(value);
const keeperOf = (state: PenaltyState) => 1 - state.kicker;

function finish(state: PenaltyState, winner: number, reason: NonNullable<PenaltyState['finishReason']>, out: Out) {
  state.phase = 'finished';
  state.winnerId = state.players[winner].playerId;
  state.finishReason = reason;
  state.turnDeadline = null;
  const pot = state.config.stake * state.players.length;
  if (pot > 0) {
    out.ledger.push({ playerId: state.winnerId, amount: pot, key: `payout:${state.winnerId}`, type: 'payout', description: 'Penalty Shootout win — pot' });
  }
  out.events.push({ type: 'game_won', playerId: state.winnerId, data: { pot, reason } });
}

function forfeit(state: PenaltyState, index: number, reason: string, out: Out) {
  state.players[index].status = 'forfeited';
  out.events.push({ type: 'forfeit', playerId: state.players[index].playerId, data: { reason } });
  finish(state, 1 - index, 'forfeit', out);
}

/** The winner's index once the shootout can no longer be level, or null to play on. */
function decided(state: PenaltyState): number | null {
  const [a, b] = state.players;
  const n = state.config.kicks;
  const taken = [a.kicks.length, b.kicks.length];
  if (taken[0] < n || taken[1] < n) {
    // Regular kicks: stop as soon as one side can't be caught.
    if (a.goals > b.goals + (n - taken[1])) return 0;
    if (b.goals > a.goals + (n - taken[0])) return 1;
    return null;
  }
  // Both have taken their kicks: compare whenever each has had the same number.
  if (taken[0] === taken[1] && a.goals !== b.goals) return a.goals > b.goals ? 0 : 1;
  return null;
}

function resolveKick(state: PenaltyState, ctx: EngineContext, out: Out) {
  const kicker = state.players[state.kicker];
  const keeper = state.players[keeperOf(state)];
  const aim = kicker.choice!;
  const dive = keeper.choice!;
  const goal = aim !== dive;
  kicker.kicks.push(goal ? 'goal' : 'saved');
  if (goal) kicker.goals += 1;
  kicker.choice = null;
  keeper.choice = null;
  state.lastKick = {
    seq: state.players[0].kicks.length + state.players[1].kicks.length,
    kickerId: kicker.playerId,
    keeperId: keeper.playerId,
    aim,
    dive,
    goal,
  };
  out.events.push({ type: 'kick', playerId: kicker.playerId, data: { aim, dive, goal } });

  const winner = decided(state);
  if (winner !== null) {
    finish(state, winner, 'score', out);
    return;
  }
  const total = state.players[0].kicks.length + state.players[1].kicks.length;
  if (total >= state.config.maxKicks && state.players[0].kicks.length === state.players[1].kicks.length) {
    finish(state, ctx.rng.int(2), 'coin', out);
    return;
  }
  state.kicker = keeperOf(state);
  state.turnDeadline = ctx.now + PENALTY_REVEAL_MS + state.config.turnSeconds * 1000;
}

export const penaltyEngine: GameEngine<PenaltyState, PenaltyConfig, PenaltyView> = {
  slug: 'penalty',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const config: PenaltyConfig = { ...DEFAULT_PENALTY_CONFIG, stake: intInRange(stake, 0, 1_000_000, 'stake') };
    if (raw.kicks !== undefined) config.kicks = intInRange(raw.kicks, 1, 10, 'kicks');
    if (raw.turnSeconds !== undefined) config.turnSeconds = intInRange(raw.turnSeconds, 5, 60, 'turnSeconds');
    if (raw.maxKicks !== undefined && config.maxKicks < config.kicks * 2) throw new ConfigError('maxKicks is too low');
    return config;
  },

  playerLimits: () => ({ min: 2, max: 2 }),

  start(players, config, ctx) {
    if (players.length !== 2) return fail('BAD_PLAYER_COUNT', 'A shootout needs exactly 2 players');
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const out: Out = { events: [], ledger: [] };
    for (const p of ordered) {
      if (config.stake > 0) {
        if ((ctx.balances[p.playerId] ?? 0) < config.stake) return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the entry stake');
        out.ledger.push({ playerId: p.playerId, amount: -config.stake, key: `stake:${p.playerId}`, type: 'stake', description: 'Penalty Shootout entry stake' });
      }
    }
    const state: PenaltyState = {
      config,
      players: ordered.map((p) => ({ playerId: p.playerId, seat: p.seat, status: 'active', goals: 0, kicks: [], missedTurns: 0, choice: null })),
      kicker: ctx.rng.int(2),
      phase: 'choosing',
      turnDeadline: ctx.now + config.turnSeconds * 1000,
      lastKick: null,
      winnerId: null,
      finishReason: null,
    };
    out.events.push({ type: 'started', data: { first: state.players[state.kicker].playerId } });
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
    if (type !== 'choose') return fail('UNKNOWN_ACTION', 'Unknown action');
    const side = asRecord(action).side;
    if (!isSide(side)) return fail('BAD_SIDE', 'Choose left, center or right');
    const player = state.players[index];
    if (player.choice !== null) return fail('ALREADY_CHOSEN', 'You have already chosen for this kick');
    player.choice = side;
    player.missedTurns = 0;
    if (state.players.every((p) => p.choice !== null)) resolveKick(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  tick(prev, ctx) {
    if (prev.phase === 'finished' || prev.turnDeadline === null || ctx.now < prev.turnDeadline) return null;
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (p.choice !== null) continue;
      p.missedTurns += 1;
      out.events.push({ type: 'timeout', playerId: p.playerId, data: { missedTurns: p.missedTurns } });
      if (p.missedTurns >= state.config.maxMissedTurns) {
        forfeit(state, i, 'Missed too many turns', out);
        return ok(state, out.events, out.ledger);
      }
      p.choice = PENALTY_SIDES[ctx.rng.int(PENALTY_SIDES.length)];
    }
    resolveKick(state, ctx, out);
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
    const kicker = state.players[state.kicker];
    const keeper = state.players[keeperOf(state)];
    const other = me ? state.players.find((p) => p !== me)! : null;
    const finished = state.phase === 'finished';
    return {
      game: 'penalty',
      config: state.config,
      phase: state.phase,
      players: state.players.map((p) => ({ playerId: p.playerId, seat: p.seat, status: p.status, goals: p.goals, kicks: [...p.kicks] })),
      kickerId: kicker.playerId,
      keeperId: keeper.playerId,
      suddenDeath: state.players.every((p) => p.kicks.length >= state.config.kicks),
      myRole: !me || finished ? null : me === kicker ? 'kicker' : 'keeper',
      myChoice: me?.choice ?? null,
      opponentReady: !finished && other?.choice != null,
      canChoose: !finished && me !== null && me.choice === null,
      turnDeadline: state.turnDeadline,
      lastKick: state.lastKick,
      winnerId: state.winnerId,
      finishReason: state.finishReason,
    };
  },
};
