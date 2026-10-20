import {
  CRAZY_MAX_PLAYERS,
  CRAZY_MIN_PLAYERS,
  DEFAULT_CRAZY_CONFIG,
  DEFAULT_CRAZY_RULES,
  RANKS,
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
  type Rank,
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
  /** Null while the pile is empty (the starter opens it with any card). */
  activeSuit: Suit | null;
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

/** Penalty points of a card left in hand: a wild card (8, J) = 50, K Q J 10 = 10, A = 1, others face value. */
export function crazyCardPoints(card: Card, wildRanks: readonly Rank[] = DEFAULT_CRAZY_RULES.wildRanks): number {
  const r = cardRank(card);
  if (wildRanks.includes(r)) return 50;
  if (r === 'A') return 1;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

export const crazyHandPoints = (hand: Card[], wildRanks?: readonly Rank[]) => hand.reduce((sum, c) => sum + crazyCardPoints(c, wildRanks), 0);

const isWild = (card: Card, rules: CrazyRules) => rules.wildRanks.includes(cardRank(card));
const isDrawTwo = (card: Card, rules: CrazyRules) => rules.drawTwo && cardRank(card) === '2';
const RANK_NAME: Record<string, string> = { '8': '8', J: 'Jack' };

/** Cards of `hand` that may be played on the current table. */
export function playableCards(state: CrazyState, hand: Card[]): Card[] {
  const { rules } = state.config;
  const top = state.discard[state.discard.length - 1];
  if (state.pendingDraw > 0) return rules.stackDrawTwo ? hand.filter((c) => isDrawTwo(c, rules)) : [];
  // The starter opens an empty pile with any card.
  if (!top) return [...hand];
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
    if (best < 0 || crazyHandPoints(p.hand, state.config.rules.wildRanks) < crazyHandPoints(state.players[best].hand, state.config.rules.wildRanks)) best = i;
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

/** The next active player after `index`. */
function nextActive(state: CrazyState, index: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (index + step) % n;
    if (state.players[idx].status === 'active') return idx;
  }
  return index;
}

/**
 * Plays `cards` in order: the first is the played card, the rest are carried with a 7
 * (its suit, plus wild cards of any suit). The last card's effect applies: a wild names
 * the suit, a 2 adds to the draw, a 5 skips the next player (with two players you play
 * again). A 7 played on its own skips like a 5.
 */
function play(state: CrazyState, cards: Card[], suit: Suit | undefined, ctx: EngineContext, out: Out) {
  const player = state.players[state.current];
  const { rules } = state.config;
  for (const card of cards) {
    player.hand.splice(player.hand.indexOf(card), 1);
    state.discard.push(card);
  }
  const last = cards[cards.length - 1];
  state.activeSuit = isWild(last, rules) ? suit! : cardSuit(last);
  if (isDrawTwo(last, rules)) state.pendingDraw += 2;
  state.passesInRow = 0;
  const loneCarry = rules.loneCarrySkips && cards.length === 1 && rules.carryRank !== null && cardRank(last) === rules.carryRank;
  const skip = (rules.skipRank !== null && cardRank(last) === rules.skipRank) || loneCarry;
  const skipped = skip && activeCount(state) > 1 ? state.players[nextActive(state, state.current)].playerId : undefined;
  state.lastEvent = {
    playerId: player.playerId,
    kind: 'play',
    card: last,
    ...(cards.length > 1 ? { cards: [...cards] } : {}),
    ...(isWild(last, rules) ? { suit: state.activeSuit } : {}),
    ...(skipped ? { skipped } : {}),
  };
  out.events.push({ type: 'play', playerId: player.playerId, data: { cards, suit: state.activeSuit, pendingDraw: state.pendingDraw, skipped } });
  if (player.hand.length === 0) {
    finish(state, state.current, 'out', out);
    return;
  }
  nextTurn(state, ctx);
  if (skipped) nextTurn(state, ctx);
}

/**
 * Checks a carried play: the first card must be the carry rank, the rest of its suit
 * (or wild cards of any suit, which count as its suit), all held and distinct.
 */
function carryError(state: CrazyState, hand: Card[], card: Card, carry: unknown): string | null {
  if (carry === undefined || (Array.isArray(carry) && carry.length === 0)) return null;
  if (!Array.isArray(carry)) return 'Bad carried cards';
  const { rules } = state.config;
  const { carryRank } = rules;
  if (carryRank === null || cardRank(card) !== carryRank) return `Only a ${carryRank ?? 'carry card'} can carry other cards`;
  const seen = new Set<Card>([card]);
  for (const c of carry) {
    if (!isValidCard(c) || !hand.includes(c)) return 'You do not hold that card';
    if (seen.has(c)) return 'A card can only be dropped once';
    if (cardSuit(c) !== cardSuit(card) && !(rules.carryWilds && isWild(c, rules))) return `A ${carryRank} can only carry cards of its own suit${rules.carryWilds ? ' and wild cards' : ''}`;
    seen.add(c);
  }
  return null;
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
  const { maxDraws, passAfterDraws } = state.config.rules;
  const limitReached = maxDraws > 0 && state.drawsThisTurn >= maxDraws;
  return state.drawsThisTurn >= passAfterDraws || limitReached || drawable(state) === 0;
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

/**
 * A timed-out turn (before the last allowed timeout): the player takes any pending
 * draw-two cards, or else draws one card, and the turn passes. Nothing is played for them.
 */
function timeoutTurn(state: CrazyState, ctx: EngineContext, out: Out) {
  const player = state.players[state.current];
  if (state.pendingDraw > 0) return takePenalty(state, ctx, out);
  if (!canDraw(state)) return pass(state, ctx, out);
  drawOne(state, player, ctx, out);
  state.passesInRow = 0;
  state.lastEvent = { playerId: player.playerId, kind: 'timeout', count: 1 };
  nextTurn(state, ctx);
}

/**
 * Games saved under earlier rule sets keep the rules they started with. The first
 * release had only 8s wild, no skip or carry, and passing after the draw limit; the
 * second added 8/J wild, 7 carry and 5 skip, but no lone-7 skip, wild carrying or opener.
 */
function upgrade(s: CrazyState): CrazyState {
  const rules = s.config.rules as Partial<CrazyRules> & { eightsWild?: boolean };
  if (typeof rules.starterOpens === 'boolean') return s;
  const legacy: CrazyRules = {
    ...DEFAULT_CRAZY_RULES,
    ...rules,
    loneCarrySkips: false,
    carryWilds: false,
    starterOpens: false,
    maxDraws: rules.maxDraws ?? 3,
    ...(Array.isArray(rules.wildRanks)
      ? {}
      : { wildRanks: rules.eightsWild === false ? [] : ['8'], skipRank: null, carryRank: null, passAfterDraws: rules.maxDraws || 3 }),
  } as CrazyRules;
  delete (legacy as { eightsWild?: boolean }).eightsWild;
  return { ...s, config: { ...s.config, rules: legacy } };
}

function validateRules(input: unknown): CrazyRules {
  const raw = asRecord(input);
  const rules: CrazyRules = { ...DEFAULT_CRAZY_RULES };
  if (raw.wildRanks !== undefined) {
    if (!Array.isArray(raw.wildRanks) || raw.wildRanks.some((r) => !(RANKS as readonly unknown[]).includes(r))) throw new ConfigError('rules.wildRanks must be a list of ranks');
    rules.wildRanks = [...new Set(raw.wildRanks as Rank[])];
  }
  for (const key of ['skipRank', 'carryRank'] as const) {
    if (raw[key] !== undefined) {
      if (raw[key] !== null && !(RANKS as readonly unknown[]).includes(raw[key])) throw new ConfigError(`rules.${key} must be a rank or null`);
      rules[key] = raw[key] as Rank | null;
    }
  }
  if (raw.passAfterDraws !== undefined) rules.passAfterDraws = intInRange(raw.passAfterDraws, 0, 10, 'rules.passAfterDraws');
  for (const key of ['drawTwo', 'stackDrawTwo', 'loneCarrySkips', 'carryWilds', 'starterOpens'] as const) {
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
    const first = ctx.rng.int(ordered.length);
    const hands: Card[][] = ordered.map(() => []);
    for (let r = 0; r < size; r++) for (const h of hands) h.push(stock.pop()!);
    let starter: Card | null = null;
    if (config.rules.starterOpens) {
      // The starter gets one extra card and opens the empty pile with any card.
      hands[first].push(stock.pop()!);
    } else {
      // The starter card: a wild card (8, J) goes back into the middle of the stock and another is turned.
      starter = stock.pop()!;
      while (config.rules.wildRanks.includes(cardRank(starter))) {
        stock.splice(ctx.rng.int(stock.length + 1), 0, starter);
        starter = stock.pop()!;
      }
    }
    const state: CrazyState = {
      config,
      players: ordered.map((p, i) => ({ playerId: p.playerId, seat: p.seat, hand: hands[i], status: 'active', missedTurns: 0 })),
      stock,
      discard: starter ? [starter] : [],
      activeSuit: starter ? cardSuit(starter) : null,
      pendingDraw: 0,
      current: first,
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

  act(saved, playerId, action, ctx) {
    const prev = upgrade(saved);
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
        const { card, suit, carry } = asRecord(action);
        if (!isValidCard(card) || !player.hand.includes(card)) return fail('NOT_IN_HAND', 'You do not hold that card');
        const carryProblem = carryError(state, player.hand, card, carry);
        if (carryProblem) return fail('BAD_CARRY', carryProblem);
        const cards = [card, ...((carry as Card[] | undefined) ?? [])];
        const last = cards[cards.length - 1];
        if (!playableCards(state, player.hand).includes(card)) {
          return fail(
            'ILLEGAL_CARD',
            state.pendingDraw > 0 ? `Answer with a 2 or draw ${state.pendingDraw} cards` : 'That card does not match the suit or rank on the pile',
          );
        }
        if (isWild(last, state.config.rules) && !(SUITS as readonly unknown[]).includes(suit)) return fail('NAME_A_SUIT', `Name the suit for your ${RANK_NAME[cardRank(last)]}`);
        play(state, cards, suit as Suit | undefined, ctx, out);
        return ok(state, out.events, out.ledger);
      }
      case 'draw': {
        if (state.pendingDraw > 0) {
          takePenalty(state, ctx, out);
          return ok(state, out.events, out.ledger);
        }
        if (!canDraw(state)) return fail('NO_DRAW', drawable(state) === 0 ? 'There are no cards left to draw — pass' : 'You have drawn the most cards allowed this turn — play or pass');
        const card = drawOne(state, player, ctx, out)!;
        state.drawsThisTurn += 1;
        state.passesInRow = 0;
        state.lastEvent = { playerId, kind: 'draw', count: 1 };
        out.events.push({ type: 'draw', playerId, data: { card } });
        return ok(state, out.events, out.ledger);
      }
      case 'pass': {
        if (!canPass(state)) return fail('CANNOT_PASS', state.pendingDraw > 0 ? `Draw ${state.pendingDraw} cards or answer with a 2` : 'Draw a card first');
        pass(state, ctx, out);
        return ok(state, out.events, out.ledger);
      }
      default:
        return fail('UNKNOWN_ACTION', 'Unknown action');
    }
  },

  tick(saved, ctx) {
    if (saved.phase === 'finished' || saved.turnDeadline === null || ctx.now < saved.turnDeadline) return null;
    const state = clone(upgrade(saved));
    const out: Out = { events: [], ledger: [] };
    const player = state.players[state.current];
    // Timeouts count over the whole game: the first draws a card and passes, the last one loses.
    player.missedTurns += 1;
    out.events.push({ type: 'timeout', playerId: player.playerId, data: { missedTurns: player.missedTurns } });
    if (player.missedTurns >= state.config.maxMissedTurns) forfeit(state, state.current, 'Ran out of time too many times', ctx, out);
    else timeoutTurn(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (s) => s.turnDeadline,

  isFinished: (s) => s.phase === 'finished',

  placements(saved) {
    if (saved.phase !== 'finished') return null;
    const state = upgrade(saved);
    const rest = state.players
      .filter((p) => p.playerId !== state.winnerId && p.status === 'active')
      .sort((a, b) => crazyHandPoints(a.hand, state.config.rules.wildRanks) - crazyHandPoints(b.hand, state.config.rules.wildRanks));
    const order = [state.winnerId!, ...rest.map((p) => p.playerId), ...[...state.forfeitOrder].reverse()];
    return order.map<Placement>((playerId, i) => ({ playerId, placement: i + 1, outcome: playerId === state.winnerId ? 'win' : 'loss' }));
  },

  view(saved, viewerId): CrazyView {
    const s = upgrade(saved);
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
        points: finished && p.status === 'active' ? crazyHandPoints(p.hand, s.config.rules.wildRanks) : null,
      })),
      hand: viewer ? [...viewer.hand] : [],
      currentPlayerId: finished ? null : current.playerId,
      phase: s.phase,
      topCard: s.discard[s.discard.length - 1] ?? null,
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
