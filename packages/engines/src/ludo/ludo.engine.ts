import {
  DEFAULT_LUDO_CONFIG,
  LUDO,
  LUDO_SEAT_COLORS,
  ludoAbsoluteSquare,
  type LudoColor,
  type LudoConfig,
  type LudoLastEvent,
  type LudoPlayerStatus,
  type LudoView,
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
  type EngineResult,
  type GameEngine,
  type LedgerIntent,
  type Placement,
  type SeatedPlayer,
} from '../core';

export interface LudoPlayerState {
  playerId: string;
  seat: number;
  color: LudoColor;
  tokens: number[];
  status: LudoPlayerStatus;
  missedTurns: number;
}

export interface LudoState {
  config: LudoConfig;
  players: LudoPlayerState[];
  current: number;
  phase: 'roll' | 'move' | 'finished';
  die: number | null;
  consecutiveSixes: number;
  turnDeadline: number | null;
  turn: number;
  winnerId: string | null;
  lastEvent: LudoLastEvent | null;
  /** Player ids in the order they forfeited (for placements). */
  forfeitOrder: string[];
}

interface StepOutput {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

/** Tokens of `player` that may legally move with `die`. */
export function legalLudoTokens(player: LudoPlayerState, die: number): number[] {
  const legal: number[] = [];
  player.tokens.forEach((progress, i) => {
    if (progress === LUDO.YARD) {
      if (die === 6) legal.push(i);
    } else if (progress < LUDO.HOME && progress + die <= LUDO.HOME) {
      legal.push(i);
    }
  });
  return legal;
}

function isSafeSquare(abs: number): boolean {
  return LUDO.SAFE_SQUARES.includes(abs);
}

function activeCount(state: LudoState): number {
  return state.players.filter((p) => p.status === 'active').length;
}

function setDeadline(state: LudoState, ctx: EngineContext) {
  state.turnDeadline = state.phase === 'finished' ? null : ctx.now + state.config.turnSeconds * 1000;
}

function finish(state: LudoState, winnerIndex: number, out: StepOutput) {
  const winner = state.players[winnerIndex];
  state.phase = 'finished';
  state.winnerId = winner.playerId;
  state.die = null;
  state.turnDeadline = null;
  const pot = state.config.stake * state.players.length;
  if (pot > 0) {
    out.ledger.push({
      playerId: winner.playerId,
      amount: pot,
      key: `payout:${winner.playerId}`,
      type: 'payout',
      description: 'Ludo win — pot',
    });
  }
  out.events.push({ type: 'game_won', playerId: winner.playerId, data: { pot } });
}

function passTurn(state: LudoState, ctx: EngineContext) {
  state.consecutiveSixes = 0;
  state.die = null;
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.current + step) % n;
    if (state.players[idx].status === 'active') {
      state.current = idx;
      break;
    }
  }
  state.phase = 'roll';
  state.turn += 1;
  setDeadline(state, ctx);
}

function forfeit(state: LudoState, index: number, reason: string, ctx: EngineContext, out: StepOutput) {
  const player = state.players[index];
  if (player.status !== 'active') return;
  player.status = 'forfeited';
  player.tokens = player.tokens.map(() => LUDO.YARD);
  state.forfeitOrder.push(player.playerId);
  state.lastEvent = { playerId: player.playerId, kind: 'forfeit', reason };
  out.events.push({ type: 'forfeit', playerId: player.playerId, data: { reason } });

  if (activeCount(state) === 1) {
    finish(state, state.players.findIndex((p) => p.status === 'active'), out);
    return;
  }
  if (state.current === index) passTurn(state, ctx);
}

function performMove(state: LudoState, token: number, ctx: EngineContext, out: StepOutput) {
  const player = state.players[state.current];
  const die = state.die!;
  const from = player.tokens[token];
  const to = from === LUDO.YARD ? 0 : from + die;
  player.tokens[token] = to;

  const captured: { playerId: string; token: number }[] = [];
  const abs = ludoAbsoluteSquare(player.color, to);
  if (abs !== null && !isSafeSquare(abs)) {
    for (const other of state.players) {
      if (other === player || other.status !== 'active') continue;
      other.tokens.forEach((p, i) => {
        if (ludoAbsoluteSquare(other.color, p) === abs) {
          other.tokens[i] = LUDO.YARD;
          captured.push({ playerId: other.playerId, token: i });
        }
      });
    }
  }

  const reachedHome = to === LUDO.HOME;
  const extraTurn =
    die === 6 ||
    (captured.length > 0 && state.config.extraTurnOnCapture) ||
    (reachedHome && state.config.extraTurnOnHome);

  state.lastEvent = { playerId: player.playerId, kind: 'move', die, token, from, to, captured, extraTurn };
  out.events.push({ type: 'move', playerId: player.playerId, data: { die, token, from, to, captured } });

  if (player.tokens.every((p) => p === LUDO.HOME)) {
    player.status = 'finished';
    finish(state, state.current, out);
    return;
  }
  if (extraTurn) {
    if (die !== 6) state.consecutiveSixes = 0;
    state.phase = 'roll';
    state.die = null;
    setDeadline(state, ctx);
  } else {
    passTurn(state, ctx);
  }
}

/** Picks the token an automated (timed-out) turn should move: the most advanced legal token. */
function autoToken(player: LudoPlayerState, legal: number[]): number {
  return legal.reduce((best, t) => (player.tokens[t] > player.tokens[best] ? t : best), legal[0]);
}

function performRoll(state: LudoState, ctx: EngineContext, out: StepOutput, automated: boolean) {
  const player = state.players[state.current];
  const die = ctx.rng.int(6) + 1;
  state.die = die;
  state.consecutiveSixes = die === 6 ? state.consecutiveSixes + 1 : 0;
  out.events.push({ type: 'roll', playerId: player.playerId, data: { die } });

  if (state.consecutiveSixes === 3) {
    state.lastEvent = { playerId: player.playerId, kind: 'skip', die, reason: 'Three sixes in a row — turn forfeited' };
    passTurn(state, ctx);
    return;
  }

  const legal = legalLudoTokens(player, die);
  if (legal.length === 0) {
    if (die === 6) {
      state.lastEvent = { playerId: player.playerId, kind: 'skip', die, extraTurn: true, reason: 'No legal move — roll again' };
      state.die = null;
      setDeadline(state, ctx);
    } else {
      state.lastEvent = { playerId: player.playerId, kind: 'skip', die, reason: 'No legal move' };
      passTurn(state, ctx);
    }
    return;
  }

  const allEquivalent = legal.every((t) => player.tokens[t] === player.tokens[legal[0]]);
  if (automated || (state.config.autoMoveSingle && allEquivalent)) {
    performMove(state, automated ? autoToken(player, legal) : legal[0], ctx, out);
    return;
  }
  state.lastEvent = { playerId: player.playerId, kind: 'roll', die };
  state.phase = 'move';
  setDeadline(state, ctx);
}

export const ludoEngine: GameEngine<LudoState, LudoConfig> = {
  slug: 'ludo',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const config: LudoConfig = { ...DEFAULT_LUDO_CONFIG, stake };
    if (raw.turnSeconds !== undefined) config.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
    if (raw.maxMissedTurns !== undefined) config.maxMissedTurns = intInRange(raw.maxMissedTurns, 1, 10, 'maxMissedTurns');
    for (const key of ['extraTurnOnCapture', 'extraTurnOnHome', 'autoMoveSingle'] as const) {
      if (raw[key] !== undefined) {
        if (typeof raw[key] !== 'boolean') throw new ConfigError(`${key} must be a boolean`);
        config[key] = raw[key] as boolean;
      }
    }
    intInRange(stake, 0, 1_000_000, 'stake');
    return config;
  },

  playerLimits: () => ({ min: 2, max: 4 }),

  start(players, config, ctx) {
    if (players.length < 2 || players.length > 4) return fail('BAD_PLAYER_COUNT', 'Ludo needs 2–4 players');
    const colors = LUDO_SEAT_COLORS[players.length];
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const out: StepOutput = { events: [], ledger: [] };
    for (const p of ordered) {
      if (config.stake > 0) {
        if ((ctx.balances[p.playerId] ?? 0) < config.stake) {
          return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the entry stake');
        }
        out.ledger.push({ playerId: p.playerId, amount: -config.stake, key: `stake:${p.playerId}`, type: 'stake', description: 'Ludo entry stake' });
      }
    }
    const state: LudoState = {
      config,
      players: ordered.map((p, i) => ({
        playerId: p.playerId,
        seat: p.seat,
        color: colors[i],
        tokens: Array(LUDO.TOKENS_PER_PLAYER).fill(LUDO.YARD),
        status: 'active',
        missedTurns: 0,
      })),
      current: ctx.rng.int(ordered.length),
      phase: 'roll',
      die: null,
      consecutiveSixes: 0,
      turnDeadline: null,
      turn: 1,
      winnerId: null,
      lastEvent: null,
      forfeitOrder: [],
    };
    setDeadline(state, ctx);
    out.events.push({ type: 'started', data: { first: state.players[state.current].playerId } });
    return ok(state, out.events, out.ledger);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'The match has finished');
    const state = clone(prev);
    const out: StepOutput = { events: [], ledger: [] };
    const index = state.players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return fail('NOT_IN_MATCH', 'You are not a player in this match');
    const player = state.players[index];
    if (player.status !== 'active') return fail('NOT_ACTIVE', 'You are no longer playing in this match');

    const type = actionType(action);
    if (type === 'leave') {
      forfeit(state, index, 'Left the match', ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (index !== state.current) return fail('NOT_YOUR_TURN', 'It is not your turn');

    if (type === 'roll') {
      if (state.phase !== 'roll') return fail('WRONG_PHASE', 'You must move a token before rolling again');
      player.missedTurns = 0;
      performRoll(state, ctx, out, false);
      return ok(state, out.events, out.ledger);
    }
    if (type === 'move') {
      if (state.phase !== 'move' || state.die === null) return fail('WRONG_PHASE', 'Roll the die first');
      const token = asRecord(action).token;
      if (typeof token !== 'number' || !Number.isInteger(token) || token < 0 || token >= LUDO.TOKENS_PER_PLAYER) {
        return fail('BAD_TOKEN', 'Unknown token');
      }
      if (!legalLudoTokens(player, state.die).includes(token)) {
        return fail('ILLEGAL_MOVE', 'That token cannot move with this roll');
      }
      player.missedTurns = 0;
      performMove(state, token, ctx, out);
      return ok(state, out.events, out.ledger);
    }
    return fail('UNKNOWN_ACTION', 'Unknown action');
  },

  tick(prev, ctx) {
    if (prev.phase === 'finished' || prev.turnDeadline === null || ctx.now < prev.turnDeadline) return null;
    const state = clone(prev);
    const out: StepOutput = { events: [], ledger: [] };
    const player = state.players[state.current];
    player.missedTurns += 1;
    out.events.push({ type: 'timeout', playerId: player.playerId, data: { missedTurns: player.missedTurns } });
    if (player.missedTurns >= state.config.maxMissedTurns) {
      forfeit(state, state.current, 'Missed too many turns', ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (state.phase === 'roll') {
      performRoll(state, ctx, out, true);
    } else {
      const legal = legalLudoTokens(player, state.die!);
      performMove(state, autoToken(player, legal), ctx, out);
    }
    return ok(state, out.events, out.ledger);
  },

  deadline: (state) => state.turnDeadline,

  isFinished: (state) => state.phase === 'finished',

  placements(state) {
    if (state.phase !== 'finished') return null;
    const progress = (p: LudoPlayerState) => p.tokens.reduce((sum, t) => sum + Math.max(t, 0), 0);
    const rest = state.players
      .filter((p) => p.playerId !== state.winnerId && p.status !== 'forfeited')
      .sort((a, b) => progress(b) - progress(a));
    const forfeited = [...state.forfeitOrder].reverse();
    const order = [state.winnerId!, ...rest.map((p) => p.playerId), ...forfeited];
    return order.map<Placement>((playerId, i) => ({
      playerId,
      placement: i + 1,
      outcome: playerId === state.winnerId ? 'win' : 'loss',
    }));
  },

  view(state, viewerId): LudoView {
    const current = state.players[state.current];
    return {
      game: 'ludo',
      players: state.players.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        color: p.color,
        status: p.status,
        tokens: [...p.tokens],
        missedTurns: p.missedTurns,
      })),
      currentPlayerId: state.phase === 'finished' ? null : current.playerId,
      phase: state.phase,
      die: state.die,
      legalTokens:
        state.phase === 'move' && viewerId === current.playerId && state.die !== null
          ? legalLudoTokens(current, state.die)
          : [],
      consecutiveSixes: state.consecutiveSixes,
      turnDeadline: state.turnDeadline,
      turn: state.turn,
      winnerId: state.winnerId,
      lastEvent: state.lastEvent,
      config: state.config,
    };
  },
};
