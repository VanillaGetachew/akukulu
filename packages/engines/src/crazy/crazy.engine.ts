import {
  CRAZY_MAX_PLAYERS,
  CRAZY_MIN_PLAYERS,
  DEFAULT_CRAZY_CONFIG,
  DEFAULT_CRAZY_RULES,
  SUITS,
  cardRank,
  cardSuit,
  isValidCard,
  standardDeck,
  type Card,
  type CrazyConfig,
  type CrazyFinishReason,
  type CrazyLastEvent,
  type CrazyPlayerStatus,
  type CrazyRules,
  type CrazyView,
  type Suit,
} from '@akukulu/shared';
import {
  ConfigError,
  actionType,
  asRecord,
  clone,
  fail,
  intInRange,
  ok,
  shuffle,
  type EngineContext,
  type EngineEvent,
  type EngineResult,
  type GameEngine,
  type LedgerIntent,
  type Placement,
} from '../core';

export interface CrazyPlayerState {
  playerId: string;
  seat: number;
  hand: Card[];
  status: CrazyPlayerStatus;
  missedTurns: number;
}

export interface CrazyState {
  config: CrazyConfig;
  players: CrazyPlayerState[];
  /** Top of the stock is the last element. */
  stock: Card[];
  /** Top of the discard pile is the last element. */
  discard: Card[];
  activeSuit: Suit;
  pendingDraw: number;
  current: number;
  phase: 'play' | 'finished';
  drawsThisTurn: number;
  /** Passes in a row with nothing left to draw; when every active player has passed the game is blocked. */
  passesInRow: number;
  turnDeadline: number | null;
  turn: number;
  winnerId: string | null;
  finishReason: CrazyFinishReason | null;
  lastEvent: CrazyLastEvent | null;
  forfeitOrder: string[];
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

/** Penalty points of a card left in hand: 8 = 50, K Q J 10 = 10, A = 1, others face value. */
export function crazyCardPoints(card: Card): number {
  const r = cardRank(card);
  if (r === '8') return 50;
  if (r === 'A') return 1;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

export const crazyHandPoints = (hand: Card[]) => hand.reduce((sum, c) => sum + crazyCardPoints(c), 0);

const isWild = (card: Card, rules: CrazyRules) => rules.eightsWild && cardRank(card) === '8';
const isDrawTwo = (card: Card, rules: CrazyRules) => rules.drawTwo && cardRank(card) === '2';

/** Cards of `hand` that may be played on the current table. */
export function playableCards(state: CrazyState, hand: Card[]): Card[] {
  const { rules } = state.config;
  const top = state.discard[state.discard.length - 1];
  if (state.pendingDraw > 0) return rules.stackDrawTwo ? hand.filter((c) => isDrawTwo(c, rules)) : [];
  return hand.filter((c) => isWild(c, rules) || cardSuit(c) === state.activeSuit || cardRank(c) === cardRank(top));
}

/** All 52 cards across hands, stock and discard (tests assert none is lost or duplicated). */
export function crazyInventory(state: CrazyState): Card[] {
  return [...state.players.flatMap((p) => p.hand), ...state.stock, ...state.discard];
}

const activeCount = (state: CrazyState) => state.players.filter((p) => p.status === 'active').length;

/** Cards that could still be drawn: the stock, plus the discards under the top card. */
const drawable = (state: CrazyState) => state.stock.length + Math.max(0, state.discard.length - 1);

function setDeadline(state: CrazyState, ctx: EngineContext) {
  state.turnDeadline = state.phase === 'finished' ? null : ctx.now + state.config.turnSeconds * 1000;
}

function nextTurn(state: CrazyState, ctx: EngineContext) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.current + step) % n;
    if (state.players[idx].status === 'active') {
      state.current = idx;
      break;
    }
  }
  state.drawsThisTurn = 0;
  state.turn += 1;
  setDeadline(state, ctx);
}

/** Moves the discards under the top card back into the stock, shuffled. */
function reshuffle(state: CrazyState, ctx: EngineContext, out: Out) {
  if (state.discard.length <= 1) return;
  const top = state.discard.pop()!;
  state.stock = shuffle(state.discard, ctx.rng);
  state.discard = [top];
  out.events.push({ type: 'reshuffle', data: { count: state.stock.length } });
}

/** Draws one card for `player`, reshuffling the discards when the stock is empty. */
function drawOne(state: CrazyState, player: CrazyPlayerState, ctx: EngineContext, out: Out): Card | null {
  if (state.stock.length === 0) reshuffle(state, ctx, out);
  const card = state.stock.pop();
  if (!card) return null;
  player.hand.push(card);
  return card;
}

function finish(state: CrazyState, winnerIndex: number, reason: CrazyFinishReason, out: Out) {
  const winner = state.players[winnerIndex];
  state.phase = 'finished';
  state.winnerId = winner.playerId;
  state.finishReason = reason;
  state.turnDeadline = null;
  const pot = state.config.stake * state.players.length;
  if (pot > 0) out.ledger.push({ playerId: winner.playerId, amount: pot, key: `payout:${winner.playerId}`, type: 'payout', description: 'Crazy win — pot' });
  out.events.push({ type: 'game_won', playerId: winner.playerId, data: { pot, reason } });
}

/** Ends a game nobody can continue: the lowest hand wins (ties go to the lower seat). */
function finishBlocked(state: CrazyState, out: Out) {
  let best = -1;
  state.players.forEach((p, i) => {
    if (p.status !== 'active') return;
    if (best < 0 || crazyHandPoints(p.hand) < crazyHandPoints(state.players[best].hand)) best = i;
  });
  finish(state, best, 'blocked', out);
}

function forfeit(state: CrazyState, index: number, reason: string, ctx: EngineContext, out: Out) {
  const player = state.players[index];
  if (player.status !== 'active') return;
  player.status = 'forfeited';
  // A forfeited hand goes under the stock so the deck stays complete.
  state.stock.unshift(...player.hand);
  player.hand = [];
  state.forfeitOrder.push(player.playerId);
  state.lastEvent = { playerId: player.playerId, kind: 'forfeit' };
  out.events.push({ type: 'forfeit', playerId: player.playerId, data: { reason } });
  if (activeCount(state) === 1) {
    finish(state, state.players.findIndex((p) => p.status === 'active'), 'forfeit', out);
    return;
  }
  if (state.current === index) {
    state.pendingDraw = 0;
    nextTurn(state, ctx);
  }
}

function play(state: CrazyState, card: Card, suit: Suit | undefined, ctx: EngineContext, out: Out) {
  const player = state.players[state.current];
  const { rules } = state.config;
  player.hand.splice(player.hand.indexOf(card), 1);
  state.discard.push(card);
  state.activeSuit = isWild(card, rules) ? suit! : cardSuit(card);
  if (isDrawTwo(card, rules)) state.pendingDraw += 2;
  state.passesInRow = 0;
  state.lastEvent = { playerId: player.playerId, kind: 'play', card, ...(isWild(card, rules) ? { suit: state.activeSuit } : {}) };
  out.events.push({ type: 'play', playerId: player.playerId, data: { card, suit: state.activeSuit, pendingDraw: state.pendingDraw } });
  if (player.hand.length === 0) {
    finish(state, state.current, 'out', out);
    return;
  }
  nextTurn(state, ctx);
}

/** Takes the stacked draw-two penalty; the turn passes. */
function takePenalty(state: CrazyState, ctx: EngineContext, out: Out) {
  const player = state.players[state.current];
  const count = state.pendingDraw;
  let drawn = 0;
  for (let i = 0; i < count; i++) if (drawOne(state, player, ctx, out)) drawn++;
  state.pendingDraw = 0;
  state.lastEvent = { playerId: player.playerId, kind: 'penalty', count: drawn };
  out.events.push({ type: 'penalty', playerId: player.playerId, data: { count: drawn } });
  nextTurn(state, ctx);
}

const canDraw = (state: CrazyState) => state.pendingDraw > 0 || ((state.config.rules.maxDraws === 0 || state.drawsThisTurn < state.config.rules.maxDraws) && drawable(state) > 0);

function canPass(state: CrazyState): boolean {
  if (state.pendingDraw > 0) return false;
  const limitReached = state.config.rules.maxDraws > 0 && state.drawsThisTurn >= state.config.rules.maxDraws;
  return limitReached || drawable(state) === 0;
}

function pass(state: CrazyState, ctx: EngineContext, out: Out) {
  const player = state.players[state.current];
  state.lastEvent = { playerId: player.playerId, kind: 'pass' };
  out.events.push({ type: 'pass', playerId: player.playerId });
  if (drawable(state) === 0) {
    state.passesInRow += 1;
    if (state.passesInRow >= activeCount(state)) {
      finishBlocked(state, out);
      return;
    }
  }
  nextTurn(state, ctx);
}

/** The suit an automated 8 names: the suit the player holds most of. */
function favouriteSuit(hand: Card[], played: Card): Suit {
  const counts = new Map<Suit, number>();
  for (const c of hand) if (c !== played && cardRank(c) !== '8') counts.set(cardSuit(c), (counts.get(cardSuit(c)) ?? 0) + 1);
  return [...SUITS].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
}

/** A timed-out turn: take a penalty, or play the best card, or draw until something fits, else pass. */
function autoTurn(state: CrazyState, ctx: EngineContext, out: Out) {
  const player = state.players[state.current];
  const { rules } = state.config;
  for (;;) {
    const options = playableCards(state, player.hand);
    if (options.length > 0) {
      // Keep 8s for last; otherwise shed the highest-scoring card.
      const pick = [...options].sort((a, b) => Number(isWild(a, rules)) - Number(isWild(b, rules)) || crazyCardPoints(b) - crazyCardPoints(a))[0];
      play(state, pick, isWild(pick, rules) ? favouriteSuit(player.hand, pick) : undefined, ctx, out);
      return;
    }
    if (state.pendingDraw > 0) return takePenalty(state, ctx, out);
    if (!canDraw(state)) return pass(state, ctx, out);
    drawOne(state, player, ctx, out);
    state.drawsThisTurn += 1;
  }
}

function validateRules(input: unknown): CrazyRules {
  const raw = asRecord(input);
  const rules: CrazyRules = { ...DEFAULT_CRAZY_RULES };
  for (const key of ['eightsWild', 'drawTwo', 'stackDrawTwo'] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') throw new ConfigError(`rules.${key} must be a boolean`);
      rules[key] = raw[key] as boolean;
    }
  }
  if (raw.maxDraws !== undefined) rules.maxDraws = intInRange(raw.maxDraws, 0, 10, 'rules.maxDraws');
  if (raw.handSizeTwoPlayers !== undefined) rules.handSizeTwoPlayers = intInRange(raw.handSizeTwoPlayers, 3, 10, 'rules.handSizeTwoPlayers');
  if (raw.handSizeMorePlayers !== undefined) rules.handSizeMorePlayers = intInRange(raw.handSizeMorePlayers, 3, 8, 'rules.handSizeMorePlayers');
  return rules;
}

export const crazyEngine: GameEngine<CrazyState, CrazyConfig, CrazyView> = {
  slug: 'crazy',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const config: CrazyConfig = { ...DEFAULT_CRAZY_CONFIG, rules: validateRules(raw.rules), stake: intInRange(stake, 0, 1_000_000, 'stake') };
    if (raw.turnSeconds !== undefined) config.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
    if (raw.maxMissedTurns !== undefined) config.maxMissedTurns = intInRange(raw.maxMissedTurns, 1, 10, 'maxMissedTurns');
    return config;
  },

  playerLimits: () => ({ min: CRAZY_MIN_PLAYERS, max: CRAZY_MAX_PLAYERS }),

  start(players, config, ctx) {
    if (players.length < CRAZY_MIN_PLAYERS || players.length > CRAZY_MAX_PLAYERS) return fail('BAD_PLAYER_COUNT', `Crazy needs ${CRAZY_MIN_PLAYERS}–${CRAZY_MAX_PLAYERS} players`);
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const out: Out = { events: [], ledger: [] };
    if (config.stake > 0) {
      for (const p of ordered) {
        if ((ctx.balances[p.playerId] ?? 0) < config.stake) return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the entry stake');
        out.ledger.push({ playerId: p.playerId, amount: -config.stake, key: `stake:${p.playerId}`, type: 'stake', description: 'Crazy entry stake' });
      }
    }
    const stock = shuffle(standardDeck(), ctx.rng);
    const size = ordered.length === 2 ? config.rules.handSizeTwoPlayers : config.rules.handSizeMorePlayers;
    const hands: Card[][] = ordered.map(() => []);
    for (let r = 0; r < size; r++) for (const h of hands) h.push(stock.pop()!);
    // The starter card: an 8 goes back into the middle of the stock and another is turned.
    let starter = stock.pop()!;
    while (config.rules.eightsWild && cardRank(starter) === '8') {
      stock.splice(ctx.rng.int(stock.length + 1), 0, starter);
      starter = stock.pop()!;
    }
    const state: CrazyState = {
      config,
      players: ordered.map((p, i) => ({ playerId: p.playerId, seat: p.seat, hand: hands[i], status: 'active', missedTurns: 0 })),
      stock,
      discard: [starter],
      activeSuit: cardSuit(starter),
      pendingDraw: 0,
      current: ctx.rng.int(ordered.length),
      phase: 'play',
      drawsThisTurn: 0,
      passesInRow: 0,
      turnDeadline: null,
      turn: 1,
      winnerId: null,
      finishReason: null,
      lastEvent: null,
      forfeitOrder: [],
    };
    setDeadline(state, ctx);
    out.events.push({ type: 'started', data: { first: state.players[state.current].playerId, starter } });
    return ok(state, out.events, out.ledger);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'The game has finished');
    const index = prev.players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return fail('NOT_IN_MATCH', 'You are not a player in this match');
    if (prev.players[index].status !== 'active') return fail('NOT_ACTIVE', 'You are no longer playing in this match');
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const player = state.players[index];
    const type = actionType(action);

    if (type === 'leave') {
      forfeit(state, index, 'Left the match', ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (index !== state.current) return fail('NOT_YOUR_TURN', 'It is not your turn');

    switch (type) {
      case 'play': {
        const { card, suit } = asRecord(action);
        if (!isValidCard(card) || !player.hand.includes(card)) return fail('NOT_IN_HAND', 'You do not hold that card');
        if (!playableCards(state, player.hand).includes(card)) {
          return fail(
            'ILLEGAL_CARD',
            state.pendingDraw > 0 ? `Answer with a 2 or draw ${state.pendingDraw} cards` : 'That card does not match the suit or rank on the pile',
          );
        }
        if (isWild(card, state.config.rules) && !(SUITS as readonly unknown[]).includes(suit)) return fail('NAME_A_SUIT', 'Name the suit for your 8');
        player.missedTurns = 0;
        play(state, card, suit as Suit | undefined, ctx, out);
        return ok(state, out.events, out.ledger);
      }
      case 'draw': {
        if (state.pendingDraw > 0) {
          player.missedTurns = 0;
          takePenalty(state, ctx, out);
          return ok(state, out.events, out.ledger);
        }
        if (!canDraw(state)) return fail('NO_DRAW', drawable(state) === 0 ? 'There are no cards left to draw — pass' : 'You have drawn the most cards allowed this turn — play or pass');
        const card = drawOne(state, player, ctx, out)!;
        state.drawsThisTurn += 1;
        state.passesInRow = 0;
        player.missedTurns = 0;
        state.lastEvent = { playerId, kind: 'draw', count: 1 };
        out.events.push({ type: 'draw', playerId, data: { card } });
        return ok(state, out.events, out.ledger);
      }
      case 'pass': {
        if (!canPass(state)) return fail('CANNOT_PASS', state.pendingDraw > 0 ? `Draw ${state.pendingDraw} cards or answer with a 2` : 'Draw a card first');
        player.missedTurns = 0;
        pass(state, ctx, out);
        return ok(state, out.events, out.ledger);
      }
      default:
        return fail('UNKNOWN_ACTION', 'Unknown action');
    }
  },

  tick(prev, ctx) {
    if (prev.phase === 'finished' || prev.turnDeadline === null || ctx.now < prev.turnDeadline) return null;
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const player = state.players[state.current];
    player.missedTurns += 1;
    out.events.push({ type: 'timeout', playerId: player.playerId, data: { missedTurns: player.missedTurns } });
    if (player.missedTurns >= state.config.maxMissedTurns) forfeit(state, state.current, 'Missed too many turns', ctx, out);
    else autoTurn(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (s) => s.turnDeadline,

  isFinished: (s) => s.phase === 'finished',

  placements(state) {
    if (state.phase !== 'finished') return null;
    const rest = state.players
      .filter((p) => p.playerId !== state.winnerId && p.status === 'active')
      .sort((a, b) => crazyHandPoints(a.hand) - crazyHandPoints(b.hand));
    const order = [state.winnerId!, ...rest.map((p) => p.playerId), ...[...state.forfeitOrder].reverse()];
    return order.map<Placement>((playerId, i) => ({ playerId, placement: i + 1, outcome: playerId === state.winnerId ? 'win' : 'loss' }));
  },

  view(s, viewerId): CrazyView {
    const finished = s.phase === 'finished';
    const current = s.players[s.current];
    const viewer = s.players.find((p) => p.playerId === viewerId) ?? null;
    const myTurn = !finished && viewer !== null && viewer === current;
    return {
      game: 'crazy',
      players: s.players.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        status: p.status,
        handCount: p.hand.length,
        missedTurns: p.missedTurns,
        revealedHand: finished && p.status === 'active' ? [...p.hand] : null,
        points: finished && p.status === 'active' ? crazyHandPoints(p.hand) : null,
      })),
      hand: viewer ? [...viewer.hand] : [],
      currentPlayerId: finished ? null : current.playerId,
      phase: s.phase,
      topCard: s.discard[s.discard.length - 1],
      activeSuit: s.activeSuit,
      pendingDraw: s.pendingDraw,
      discardCount: s.discard.length,
      discardRecent: s.discard.slice(-4),
      stockCount: s.stock.length,
      drawsThisTurn: s.drawsThisTurn,
      turnDeadline: s.turnDeadline,
      turn: s.turn,
      winnerId: s.winnerId,
      finishReason: s.finishReason,
      lastEvent: s.lastEvent,
      legal: myTurn ? { play: playableCards(s, viewer!.hand), draw: canDraw(s), pass: canPass(s) } : { play: [], draw: false, pass: false },
      config: s.config,
    };
  },
};
