import {
  BINGO_BALLS,
  BINGO_COLUMN_RANGE,
  BINGO_FREE,
  BINGO_MAX_PLAYERS,
  DEFAULT_BINGO_CONFIG,
  bingoToGo,
  bingoWinningLine,
  type BingoCard,
  type BingoConfig,
  type BingoPlayerStatus,
  type BingoView,
  type BingoWinnerView,
} from '@akukulu/shared';
import {
  actionType,
  asRecord,
  clone,
  fail,
  intInRange,
  ok,
  shuffle,
  type EngineContext,
  type EngineEvent,
  type GameEngine,
  type LedgerIntent,
  type Rng,
} from '../core';

export interface BingoPlayerState {
  playerId: string;
  seat: number;
  status: BingoPlayerStatus;
  card: BingoCard;
  swaps: number;
}

export interface BingoState {
  config: BingoConfig;
  players: BingoPlayerState[];
  /** Fixed when the match starts: leaving does not take a stake back out. */
  pot: number;
  phase: 'ready' | 'calling' | 'finished';
  /** The order the balls come out, shuffled at the start and never sent to players. */
  balls: number[];
  /** How many of `balls` have been called. */
  calledCount: number;
  nextCallAt: number | null;
  winners: BingoWinnerView[];
  finishReason: 'bingo' | 'forfeit' | null;
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

/** A random card: five numbers from each column's range, with the middle square free. */
export function dealBingoCard(rng: Rng): BingoCard {
  const card: BingoCard = new Array(25).fill(BINGO_FREE);
  for (let col = 0; col < 5; col++) {
    const range = Array.from({ length: BINGO_COLUMN_RANGE }, (_, i) => col * BINGO_COLUMN_RANGE + i + 1);
    const picks = shuffle(range, rng).slice(0, 5);
    for (let row = 0; row < 5; row++) card[row * 5 + col] = picks[row];
  }
  card[12] = BINGO_FREE;
  return card;
}

const calledSet = (state: BingoState) => new Set(state.balls.slice(0, state.calledCount));

/** Pays the pot out between the winners; any odd birr goes to the lowest seats. */
function finish(state: BingoState, winners: { player: BingoPlayerState; line: readonly number[] }[], reason: NonNullable<BingoState['finishReason']>, out: Out) {
  state.phase = 'finished';
  state.finishReason = reason;
  state.nextCallAt = null;
  const base = Math.floor(state.pot / winners.length);
  let spare = state.pot - base * winners.length;
  state.winners = winners.map(({ player, line }) => {
    const share = base + (spare-- > 0 ? 1 : 0);
    if (share > 0) {
      out.ledger.push({ playerId: player.playerId, amount: share, key: `payout:${player.playerId}`, type: 'payout', description: winners.length > 1 ? 'Bingo win — shared pot' : 'Bingo win — pot' });
    }
    out.events.push({ type: 'game_won', playerId: player.playerId, data: { share, reason } });
    return { playerId: player.playerId, card: [...player.card], line: [...line], share };
  });
}

function callBall(state: BingoState, ctx: EngineContext, out: Out) {
  const ball = state.balls[state.calledCount];
  state.calledCount += 1;
  out.events.push({ type: 'call', data: { ball, number: state.calledCount } });
  const called = calledSet(state);
  const winners = state.players
    .filter((p) => p.status === 'active')
    .map((player) => ({ player, line: bingoWinningLine(player.card, called) }))
    .filter((w): w is { player: BingoPlayerState; line: readonly number[] } => w.line !== null);
  if (winners.length > 0) {
    finish(state, winners, 'bingo', out);
    return;
  }
  state.nextCallAt = ctx.now + state.config.callSeconds * 1000;
}

export const bingoEngine: GameEngine<BingoState, BingoConfig, BingoView> = {
  slug: 'bingo',

  parseConfig(_input, stake) {
    return { ...DEFAULT_BINGO_CONFIG, stake: intInRange(stake, 0, 1_000_000, 'stake') };
  },

  playerLimits: () => ({ min: 2, max: BINGO_MAX_PLAYERS }),

  start(players, config, ctx) {
    if (players.length < 2 || players.length > BINGO_MAX_PLAYERS) return fail('BAD_PLAYER_COUNT', `Bingo needs 2 to ${BINGO_MAX_PLAYERS} players`);
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const out: Out = { events: [], ledger: [] };
    for (const p of ordered) {
      if (config.stake > 0) {
        if ((ctx.balances[p.playerId] ?? 0) < config.stake) return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the entry stake');
        out.ledger.push({ playerId: p.playerId, amount: -config.stake, key: `stake:${p.playerId}`, type: 'stake', description: 'Bingo entry stake' });
      }
    }
    const state: BingoState = {
      config,
      players: ordered.map((p) => ({ playerId: p.playerId, seat: p.seat, status: 'active', card: dealBingoCard(ctx.rng), swaps: 0 })),
      pot: config.stake * ordered.length,
      phase: 'ready',
      balls: shuffle(
        Array.from({ length: BINGO_BALLS }, (_, i) => i + 1),
        ctx.rng,
      ),
      calledCount: 0,
      nextCallAt: ctx.now + config.readySeconds * 1000,
      winners: [],
      finishReason: null,
    };
    out.events.push({ type: 'started', data: { players: ordered.length } });
    return ok(state, out.events, out.ledger);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'The match has finished');
    const index = prev.players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return fail('NOT_IN_MATCH', 'You are not a player in this match');
    if (prev.players[index].status !== 'active') return fail('NOT_PLAYING', 'You have left this game');
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const player = state.players[index];
    const type = actionType(asRecord(action));
    if (type === 'leave') {
      // The stake stays in the pot. The last player left takes it.
      player.status = 'left';
      out.events.push({ type: 'forfeit', playerId, data: { reason: 'Left the match' } });
      const remaining = state.players.filter((p) => p.status === 'active');
      if (remaining.length === 1) finish(state, [{ player: remaining[0], line: [] }], 'forfeit', out);
      return ok(state, out.events, out.ledger);
    }
    if (type === 'swap') {
      if (state.phase !== 'ready') return fail('TOO_LATE', 'Cards cannot be changed once the first number is called');
      if (player.swaps >= state.config.maxSwaps) return fail('NO_SWAPS', 'You have no card changes left');
      player.card = dealBingoCard(ctx.rng);
      player.swaps += 1;
      return ok(state, out.events, out.ledger);
    }
    return fail('UNKNOWN_ACTION', 'Unknown action');
  },

  tick(prev, ctx) {
    if (prev.phase === 'finished' || prev.nextCallAt === null || ctx.now < prev.nextCallAt) return null;
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    state.phase = 'calling';
    callBall(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (state) => state.nextCallAt,

  isFinished: (state) => state.phase === 'finished',

  placements(state) {
    if (state.phase !== 'finished') return null;
    const won = new Set(state.winners.map((w) => w.playerId));
    return state.players
      .map((p) => ({ playerId: p.playerId, placement: won.has(p.playerId) ? 1 : 2, outcome: won.has(p.playerId) ? ('win' as const) : ('loss' as const) }))
      .sort((a, b) => a.placement - b.placement);
  },

  view(state, viewerId) {
    const me = state.players.find((p) => p.playerId === viewerId) ?? null;
    const called = calledSet(state);
    return {
      game: 'bingo',
      config: state.config,
      phase: state.phase,
      players: state.players.map((p) => ({ playerId: p.playerId, seat: p.seat, status: p.status, toGo: bingoToGo(p.card, called) })),
      pot: state.pot,
      myCard: me ? [...me.card] : null,
      swapsLeft: me && state.phase === 'ready' && me.status === 'active' ? state.config.maxSwaps - me.swaps : 0,
      called: state.balls.slice(0, state.calledCount),
      nextCallAt: state.nextCallAt,
      winners: state.winners,
      finishReason: state.finishReason,
    };
  },
};
