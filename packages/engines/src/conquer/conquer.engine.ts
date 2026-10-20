import {
  CONQUER_PREDICTIONS,
  CONQUER_PREDICTION_LABEL,
  CONQUER_UNVERIFIED_RULES,
  DEFAULT_CONQUER_CONFIG,
  DEFAULT_CONQUER_RULES,
  HIDDEN_CARD,
  RANK_LABEL,
  SUIT_SYMBOL,
  isValidCard,
  deckWithJokers,
  isPrintedJoker,
  standardDeck,
  type Card,
  type ConquerConfig,
  type ConquerLastEvent,
  type ConquerLayoffSpec,
  type ConquerMeldSpec,
  type ConquerPhase,
  type ConquerPrediction,
  type ConquerRoundResult,
  type ConquerView,
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
import {
  extendMeld,
  interpretMeld,
  openingPoints,
  penaltyValue,
  selectWildcards,
  type Interpretation,
  type MeldContext,
  type Placed,
} from './rules';

export interface ConquerPlayerState {
  playerId: string;
  seat: number;
  hand: Card[];
  opened: boolean;
  roundsWon: number;
  missedTurns: number;
  wantsRematch: boolean;
  status: 'active' | 'left';
  revealedHand: Card[] | null;
  penalty: number | null;
}

export interface MeldState {
  id: string;
  ownerId: string;
  kind: 'set' | 'run';
  /** `owner` records who contributed each physical card (melds and lay-offs). */
  placed: (Placed & { ownerId: string })[];
}

export interface ConquerState {
  config: ConquerConfig;
  players: ConquerPlayerState[];
  round: number;
  phase: ConquerPhase;
  predictor: number;
  current: number;
  /** During prediction the base card is physically set aside; afterwards it is only a record. */
  baseCard: Card | null;
  baseSetAside: boolean;
  prediction: ConquerPrediction | null;
  wildCards: Card[];
  wildRanks: Rank[];
  wildSuits: Suit[] | null;
  /** Face-down stock; the last element is the top. Server-only. */
  stock: Card[];
  /** Face-up discard pile; the last element is the top. */
  discard: Card[];
  melds: MeldState[];
  meldSeq: number;
  /** A wildcard taken by swap that must be used before discarding. */
  pendingWild: Card | null;
  /** A discard taken this turn that must be melded or laid off before discarding. */
  pendingPickup: Card | null;
  /** The base card is still face-up at the bottom of the deck. */
  baseVisible: boolean;
  /** How many times the discard pile has been reshuffled into the deck this round. */
  reshuffles: number;
  /** Points laid down this turn by a player who has not opened yet (sets may go down one at a time). */
  openingProgress: number;
  /** Took the discard before opening: must reach the threshold this turn to be allowed to discard. */
  mustOpen: boolean;
  /** Took the base card: must go out this turn. */
  mustFinish: boolean;
  turnDeadline: number | null;
  lastEvent: ConquerLastEvent | null;
  roundResult: ConquerRoundResult | null;
  history: ConquerRoundResult[];
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

const cardLabel = (c: Card) => (isPrintedJoker(c) ? 'Joker' : `${RANK_LABEL[c[0] as Rank]}${SUIT_SYMBOL[c[1] as Suit]}`);
/** Cards a printed joker may copy this round: the chosen joker cards. */
export const falseJokerAs = (state: ConquerState): Card[] => (state.config.rules.wild.printedJokers ? state.wildCards : []);
/** The physical deck for a rule set: 54 cards with the printed jokers, otherwise 52. */
const physicalDeck = (rules: ConquerConfig['rules']) => (rules.wild.printedJokers ? deckWithJokers() : standardDeck());

function meldContext(state: ConquerState, excludeMeldId?: string): MeldContext {
  const taken = new Set<Card>();
  for (const m of state.melds) if (m.id !== excludeMeldId) for (const p of m.placed) taken.add(p.as);
  return { wild: new Set(state.wildCards), rules: state.config.rules, taken, falseJokerAs: falseJokerAs(state) };
}

const toInterp = (m: MeldState): Interpretation => ({
  kind: m.kind,
  placed: m.placed.map(({ ownerId: _o, ...p }) => p),
  points: m.placed.reduce((s, p) => s + p.points, 0),
});

function setDeadline(state: ConquerState, ctx: EngineContext) {
  const c = state.config;
  if (state.phase === 'predict') state.turnDeadline = ctx.now + c.predictSeconds * 1000;
  else if (state.phase === 'draw' || state.phase === 'meld') state.turnDeadline = ctx.now + c.turnSeconds * 1000;
  else if (state.phase === 'roundOver') state.turnDeadline = ctx.now + c.rematchSeconds * 1000;
  else state.turnDeadline = null;
}

function event(state: ConquerState, out: Out, playerId: string | null, kind: string, text: string, data: Record<string, unknown> = {}) {
  state.lastEvent = { playerId, kind, text };
  out.events.push({ type: kind, playerId: playerId ?? undefined, data });
}

/** Debits stakes and sets up the prediction step for a new round. */
function beginRound(state: ConquerState, predictor: number, ctx: EngineContext, out: Out): string | null {
  const stake = state.config.stake;
  if (stake > 0) {
    for (const p of state.players) {
      if ((ctx.balances[p.playerId] ?? 0) < stake) return 'A player cannot cover the stake for another round';
    }
  }
  state.round += 1;
  for (const p of state.players) {
    if (stake > 0) {
      out.ledger.push({ playerId: p.playerId, amount: -stake, key: `r${state.round}:stake:${p.playerId}`, type: 'stake', description: `Conquer round ${state.round} stake` });
    }
    Object.assign(p, { hand: [], opened: false, missedTurns: 0, wantsRematch: false, revealedHand: null, penalty: null });
  }
  const deck = shuffle(physicalDeck(state.config.rules), ctx.rng);
  // The base card is always a regular card (a printed joker cannot set the prediction).
  const regular = deck.map((c, i) => (isPrintedJoker(c) ? -1 : i)).filter((i) => i >= 0);
  const baseIndex = regular[ctx.rng.int(regular.length)];
  state.baseCard = deck[baseIndex];
  deck.splice(baseIndex, 1);
  state.baseSetAside = true;
  state.stock = deck;
  state.discard = [];
  state.melds = [];
  state.pendingWild = null;
  state.pendingPickup = null;
  state.baseVisible = false;
  state.reshuffles = 0;
  resetTurn(state);
  state.prediction = null;
  state.wildCards = [];
  state.wildRanks = [];
  state.wildSuits = null;
  state.roundResult = null;
  state.predictor = predictor;
  state.current = predictor;
  state.phase = 'predict';
  setDeadline(state, ctx);
  event(state, out, state.players[predictor].playerId, 'round_started', `Round ${state.round}: choose the wildcards`, { round: state.round });
  return null;
}

/**
 * Applies the (blind) prediction and deals: the starter (non-predictor) gets
 * handSize cards, the predictor one fewer. The base card is placed face-up at
 * the bottom of the stock so both players can see what set the wildcards. The
 * starter opens the game by discarding, so the discard pile starts empty.
 */
function applyPrediction(state: ConquerState, choice: ConquerPrediction, ctx: EngineContext, out: Out) {
  const sel = selectWildcards(state.baseCard!, choice, state.config.rules);
  state.prediction = choice;
  // Printed jokers are not wild: each is a copy of one of these chosen cards (see falseJokerAs).
  state.wildCards = sel.cards;
  state.wildRanks = sel.ranks;
  state.wildSuits = sel.suits;
  state.baseSetAside = false;
  const deck = shuffle(state.stock, ctx.rng);
  const first = 1 - state.predictor;
  const size = state.config.rules.handSize;
  for (let i = 0; i < size * 2 - 1; i++) {
    state.players[(first + i) % 2].hand.push(deck.pop()!);
  }
  state.stock = [state.baseCard!, ...deck];
  state.baseVisible = true;
  state.discard = [];
  state.current = first;
  state.phase = 'meld';
  setDeadline(state, ctx);
  event(state, out, state.players[state.predictor].playerId, 'predicted', `Predicted ${CONQUER_PREDICTION_LABEL[choice].en} — wild: ${sel.ranks.map((r) => RANK_LABEL[r]).join(' & ')}`, { choice, wildCards: sel.cards });
}

function penaltyOf(state: ConquerState, hand: Card[]): number {
  const wild = new Set(state.wildCards);
  return hand.reduce((s, c) => s + penaltyValue(c, wild, state.config.rules, falseJokerAs(state)), 0);
}

function endRound(state: ConquerState, winner: number | null, reason: ConquerRoundResult['reason'], ctx: EngineContext, out: Out) {
  const penalties: Record<string, number> = {};
  for (const p of state.players) {
    p.revealedHand = [...p.hand];
    p.penalty = penaltyOf(state, p.hand);
    penalties[p.playerId] = p.penalty;
  }
  const stake = state.config.stake;
  if (winner !== null) {
    const w = state.players[winner];
    w.roundsWon += 1;
    if (stake > 0) out.ledger.push({ playerId: w.playerId, amount: stake * 2, key: `r${state.round}:payout:${w.playerId}`, type: 'payout', description: `Conquer round ${state.round} win` });
  } else if (stake > 0) {
    for (const p of state.players) out.ledger.push({ playerId: p.playerId, amount: stake, key: `r${state.round}:refund:${p.playerId}`, type: 'refund', description: `Conquer round ${state.round} draw — stake returned` });
  }
  state.roundResult = { round: state.round, winnerId: winner === null ? null : state.players[winner].playerId, reason, penalties };
  state.history.push(state.roundResult);
  state.pendingWild = null;
  resetTurn(state);
  state.phase = 'roundOver';
  setDeadline(state, ctx);
  const text = winner === null ? 'Round drawn' : reason === 'out' ? 'went out and won the round' : reason === 'forfeit' ? 'won by forfeit' : 'won on lower penalty';
  event(state, out, winner === null ? null : state.players[winner].playerId, 'round_over', text, { ...state.roundResult });
}

function finishMatch(state: ConquerState, out: Out) {
  state.phase = 'finished';
  state.turnDeadline = null;
  out.events.push({ type: 'match_finished', data: { history: state.history } });
}

function forfeit(state: ConquerState, index: number, reason: string, ctx: EngineContext, out: Out) {
  const p = state.players[index];
  p.status = 'left';
  event(state, out, p.playerId, 'forfeit', reason);
  if (state.phase === 'predict' || state.phase === 'draw' || state.phase === 'meld') {
    if (state.baseSetAside) {
      // Nothing was dealt yet: return the base card so the inventory stays whole.
      state.stock.push(state.baseCard!);
      state.baseSetAside = false;
    }
    endRound(state, 1 - index, 'forfeit', ctx, out);
  }
  finishMatch(state, out);
}

/** Clears per-turn obligations and progress. */
function resetTurn(state: ConquerState) {
  state.openingProgress = 0;
  state.mustOpen = false;
  state.mustFinish = false;
  state.pendingPickup = null;
}

function nextTurn(state: ConquerState, ctx: EngineContext) {
  resetTurn(state);
  state.current = 1 - state.current;
  state.phase = 'draw';
  setDeadline(state, ctx);
}

/** Removes `cards` from `hand`, failing if any card is missing or repeated. */
function takeFromHand(hand: Card[], cards: Card[]): string | null {
  for (const c of cards) {
    if (!isValidCard(c)) return `${String(c)} is not a card`;
    const i = hand.indexOf(c);
    if (i < 0) return `${c} is not in your hand`;
    hand.splice(i, 1);
  }
  return null;
}

function parseHint(raw: unknown): Record<Card, Card> {
  const out: Record<Card, Card> = {};
  for (const [k, v] of Object.entries(asRecord(raw))) if (isValidCard(k) && isValidCard(v)) out[k] = v;
  return out;
}

function parseMelds(raw: unknown): ConquerMeldSpec[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 6) return 'Melds must be a list';
  return raw.map((m) => {
    const r = asRecord(m);
    return { cards: Array.isArray(r.cards) ? (r.cards as Card[]) : [], as: parseHint(r.as) };
  });
}

function parseLayoffs(raw: unknown): ConquerLayoffSpec[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 14) return 'Lay-offs must be a list';
  return raw.map((l) => {
    const r = asRecord(l);
    return { meldId: String(r.meldId ?? ''), card: String(r.card ?? ''), as: isValidCard(r.as) ? r.as : undefined };
  });
}

/**
 * Validates and applies melds and lay-offs atomically on a working copy.
 * `required` (a taken discard) must end up on the table.
 */
function applyTablePlay(state: ConquerState, index: number, melds: ConquerMeldSpec[], layoffs: ConquerLayoffSpec[], required: Card | null): string | null {
  const p = state.players[index];
  const rules = state.config.rules;
  if (melds.length === 0 && layoffs.length === 0) return 'Nothing to lay down';
  const placedCards: Card[] = [];
  let openingTotal = 0;

  for (const spec of melds) {
    const missing = takeFromHand(p.hand, spec.cards);
    if (missing) return missing;
    const res = interpretMeld(spec.cards, meldContext(state), spec.as ?? {});
    if (!res.ok) return res.error;
    openingTotal += openingPoints(res.meld, rules);
    state.melds.push({
      id: `m${++state.meldSeq}`,
      ownerId: p.playerId,
      kind: res.meld.kind,
      placed: res.meld.placed.map((x) => ({ ...x, ownerId: p.playerId })),
    });
    placedCards.push(...spec.cards);
  }
  if (melds.length > 0 && !p.opened) {
    // Sets may go down one at a time; together they must reach the threshold this turn.
    state.openingProgress += openingTotal;
    if (state.openingProgress >= rules.openingThreshold) p.opened = true;
  }

  for (const l of layoffs) {
    if (rules.layoffRequiresOpen && !p.opened) return 'Open with 41 points before laying off';
    const meld = state.melds.find((m) => m.id === l.meldId);
    if (!meld) return 'That meld does not exist';
    if (!rules.layoffOnOpponentMelds && meld.ownerId !== p.playerId) return 'You may only lay off on your own melds';
    const missing = takeFromHand(p.hand, [l.card]);
    if (missing) return missing;
    const res = extendMeld(toInterp(meld), l.card, meldContext(state, meld.id), l.as);
    if (!res.ok) return res.error;
    const owners = new Map(meld.placed.map((x) => [x.card, x.ownerId]));
    meld.placed = res.meld.placed.map((x) => ({ ...x, ownerId: owners.get(x.card) ?? p.playerId }));
    placedCards.push(l.card);
  }

  if (required && !placedCards.includes(required)) return 'A taken discard must be used in a meld right away';
  if (rules.mustDiscardToWin && p.hand.length === 0) return 'Keep one card — you must finish by discarding';
  if (state.pendingWild && placedCards.includes(state.pendingWild)) state.pendingWild = null;
  if (state.pendingPickup && placedCards.includes(state.pendingPickup)) state.pendingPickup = null;
  return null;
}

/** Card an automated (timed-out) turn discards: the highest penalty non-wild card. */
function autoDiscardCard(state: ConquerState, hand: Card[]): Card {
  const wild = new Set(state.wildCards);
  const candidates = hand.filter((c) => !wild.has(c));
  const pool = candidates.length ? candidates : hand;
  const value = (x: Card) => penaltyValue(x, wild, state.config.rules, falseJokerAs(state));
  return pool.reduce((best, c) => (value(c) > value(best) ? c : best), pool[0]);
}

function discardCard(state: ConquerState, index: number, card: Card, ctx: EngineContext, out: Out) {
  const p = state.players[index];
  p.hand.splice(p.hand.indexOf(card), 1);
  state.discard.push(card);
  event(state, out, p.playerId, 'discard', `discarded ${cardLabel(card)}`, { card });
  if (p.hand.length === 0) {
    endRound(state, index, 'out', ctx, out);
  } else if (state.stock.length === 0 && state.config.rules.exhaustion === 'reshuffle' && state.discard.length > 1) {
    // Deck exhausted: everything but the top discard is shuffled back in as the new deck.
    const top = state.discard.pop()!;
    state.stock = shuffle(state.discard, ctx.rng);
    state.discard = [top];
    state.baseVisible = false;
    state.reshuffles += 1;
    event(state, out, null, 'reshuffle', 'The deck ran out — discards were shuffled back in', { count: state.stock.length });
    nextTurn(state, ctx);
  } else if (state.stock.length === 0) {
    const [a, b] = state.players.map((x) => penaltyOf(state, x.hand));
    const winner = state.config.rules.exhaustion === 'dead' || a === b ? null : a < b ? 0 : 1;
    endRound(state, winner, 'exhaustion', ctx, out);
  } else {
    nextTurn(state, ctx);
  }
}

export function validateConquerRules(input: unknown): ConquerConfig['rules'] {
  // Rules are server-defined; rooms cannot alter them in this release.
  if (input !== undefined) throw new ConfigError('Conquer rules cannot be changed per room');
  return DEFAULT_CONQUER_RULES;
}

export const conquerEngine: GameEngine<ConquerState, ConquerConfig, ConquerView> = {
  slug: 'conquer',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const config: ConquerConfig = { ...DEFAULT_CONQUER_CONFIG, rules: validateConquerRules(raw.rules), stake: intInRange(stake, 0, 1_000_000, 'stake') };
    if (raw.turnSeconds !== undefined) config.turnSeconds = intInRange(raw.turnSeconds, 20, 300, 'turnSeconds');
    return config;
  },

  playerLimits: () => ({ min: 2, max: 2 }),

  start(players, config, ctx) {
    if (players.length !== 2) return fail('BAD_PLAYER_COUNT', 'Conquer is played one against one');
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const state: ConquerState = {
      config,
      players: ordered.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        hand: [],
        opened: false,
        roundsWon: 0,
        missedTurns: 0,
        wantsRematch: false,
        status: 'active',
        revealedHand: null,
        penalty: null,
      })),
      round: 0,
      phase: 'predict',
      predictor: 0,
      current: 0,
      baseCard: null,
      baseSetAside: false,
      prediction: null,
      wildCards: [],
      wildRanks: [],
      wildSuits: null,
      stock: [],
      discard: [],
      melds: [],
      meldSeq: 0,
      pendingWild: null,
      pendingPickup: null,
      baseVisible: false,
      reshuffles: 0,
      openingProgress: 0,
      mustOpen: false,
      mustFinish: false,
      turnDeadline: null,
      lastEvent: null,
      roundResult: null,
      history: [],
    };
    const out: Out = { events: [], ledger: [] };
    const error = beginRound(state, ctx.rng.int(2), ctx, out);
    if (error) return fail('INSUFFICIENT_BALANCE', error);
    return ok(state, out.events, out.ledger);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'The match has finished');
    const index = prev.players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return fail('NOT_IN_MATCH', 'You are not a player in this match');
    if (prev.players[index].status !== 'active') return fail('NOT_ACTIVE', 'You have left this match');
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const p = state.players[index];
    const a = asRecord(action);
    const type = actionType(action);

    if (type === 'leave') {
      if (state.phase === 'roundOver') {
        p.status = 'left';
        event(state, out, playerId, 'left', 'left the table');
        finishMatch(state, out);
      } else {
        forfeit(state, index, 'left the match', ctx, out);
      }
      return ok(state, out.events, out.ledger);
    }

    if (type === 'rematch') {
      if (state.phase !== 'roundOver') return fail('WRONG_PHASE', 'The round is still in progress');
      if (state.config.stake > 0 && (ctx.balances[playerId] ?? 0) < state.config.stake) return fail('INSUFFICIENT_BALANCE', 'Not enough points for another round');
      p.wantsRematch = true;
      event(state, out, playerId, 'rematch', 'wants a rematch');
      if (state.players.every((x) => x.wantsRematch)) {
        const error = beginRound(state, 1 - state.predictor, ctx, out);
        if (error) return fail('INSUFFICIENT_BALANCE', error);
      }
      return ok(state, out.events, out.ledger);
    }

    if (index !== state.current) return fail('NOT_YOUR_TURN', 'It is not your turn');

    switch (type) {
      case 'predict': {
        if (state.phase !== 'predict') return fail('WRONG_PHASE', 'The wildcards have already been chosen');
        if (!CONQUER_PREDICTIONS.includes(a.choice as ConquerPrediction)) return fail('BAD_CHOICE', 'Choose Up, Down, Side or Up & Down');
        p.missedTurns = 0;
        applyPrediction(state, a.choice as ConquerPrediction, ctx, out);
        return ok(state, out.events, out.ledger);
      }
      case 'drawStock': {
        if (state.phase !== 'draw') return fail('WRONG_PHASE', state.phase === 'meld' ? 'You have already drawn this turn' : 'You cannot draw now');
        const card = state.stock.pop()!;
        if (state.stock.length === 0 || card === state.baseCard) state.baseVisible = false;
        p.hand.push(card);
        p.missedTurns = 0;
        state.phase = 'meld';
        setDeadline(state, ctx);
        event(state, out, playerId, 'draw_stock', 'drew from the stock');
        return ok(state, out.events, out.ledger);
      }
      case 'takeBase': {
        if (state.phase !== 'draw') return fail('WRONG_PHASE', state.phase === 'meld' ? 'You have already drawn this turn' : 'You cannot draw now');
        if (!state.baseVisible || state.stock[0] !== state.baseCard) return fail('NO_BASE', 'The base card is no longer under the deck');
        state.stock.shift();
        state.baseVisible = false;
        p.hand.push(state.baseCard!);
        state.mustFinish = true;
        p.missedTurns = 0;
        state.phase = 'meld';
        setDeadline(state, ctx);
        event(state, out, playerId, 'take_base', `took the base card ${cardLabel(state.baseCard!)} — must go out this turn`, { card: state.baseCard });
        return ok(state, out.events, out.ledger);
      }
      case 'takeDiscard': {
        if (state.phase !== 'draw') return fail('WRONG_PHASE', state.phase === 'meld' ? 'You have already drawn this turn' : 'You cannot draw now');
        const top = state.discard[state.discard.length - 1];
        if (!top) return fail('EMPTY_DISCARD', 'The discard pile is empty');
        const melds = parseMelds(a.melds);
        const layoffs = parseLayoffs(a.layoffs);
        if (typeof melds === 'string') return fail('BAD_ACTION', melds);
        if (typeof layoffs === 'string') return fail('BAD_ACTION', layoffs);
        state.discard.pop();
        p.hand.push(top);
        // The card joins the hand. A player who has not opened must now reach the threshold this turn.
        state.pendingPickup = top;
        if (!p.opened) state.mustOpen = true;
        if (melds.length || layoffs.length) {
          const error = applyTablePlay(state, index, melds, layoffs, null);
          if (error) return fail('ILLEGAL_PICKUP', `Cannot take ${cardLabel(top)}: ${error}`);
        }
        p.missedTurns = 0;
        state.phase = 'meld';
        setDeadline(state, ctx);
        event(state, out, playerId, 'take_discard', `took ${cardLabel(top)} from the discard pile`, { card: top });
        return ok(state, out.events, out.ledger);
      }
      case 'meld':
      case 'layoff': {
        if (state.phase !== 'meld') return fail('WRONG_PHASE', 'Draw a card first');
        const melds = type === 'meld' ? parseMelds(a.melds) : [];
        const layoffs = type === 'layoff' ? parseLayoffs(a.layoffs) : [];
        if (typeof melds === 'string') return fail('BAD_ACTION', melds);
        if (typeof layoffs === 'string') return fail('BAD_ACTION', layoffs);
        const wasOpen = p.opened;
        const error = applyTablePlay(state, index, melds, layoffs, null);
        if (error) return fail('ILLEGAL_MELD', error);
        p.missedTurns = 0;
        setDeadline(state, ctx);
        event(state, out, playerId, type, type === 'layoff' ? 'added cards to a meld' : wasOpen ? 'laid down a meld' : p.opened ? `went in with ${state.openingProgress} points` : `laid down a set (${state.openingProgress}/${state.config.rules.openingThreshold})`, { count: melds.length + layoffs.length });
        return ok(state, out.events, out.ledger);
      }
      case 'swapWild': {
        if (state.phase !== 'meld') return fail('WRONG_PHASE', 'Draw a card first');
        if (!state.config.rules.wild.allowSwap) return fail('ILLEGAL_SWAP', 'Wildcard swaps are not allowed');
        if (!p.opened) return fail('ILLEGAL_SWAP', 'Open with 41 points before swapping wildcards');
        if (state.pendingWild) return fail('ILLEGAL_SWAP', 'Use the wildcard you already took first');
        const meld = state.melds.find((m) => m.id === a.meldId);
        const card = String(a.card ?? '');
        if (!meld) return fail('ILLEGAL_SWAP', 'That meld does not exist');
        if (!p.hand.includes(card)) return fail('ILLEGAL_SWAP', `${card} is not in your hand`);
        const slot = meld.placed.find((x) => x.wild && x.as === card);
        if (!slot) return fail('ILLEGAL_SWAP', `No wildcard in that meld represents ${card}`);
        const wildCard = slot.card;
        p.hand.splice(p.hand.indexOf(card), 1);
        p.hand.push(wildCard);
        // The slot keeps its original owner: each player's hand + table cards still total 14.
        Object.assign(slot, { card, wild: false });
        if (state.config.rules.wild.swappedMustBeUsedSameTurn) state.pendingWild = wildCard;
        p.missedTurns = 0;
        event(state, out, playerId, 'swap_wild', `swapped ${cardLabel(card)} for a wildcard`, { meldId: meld.id, card, wildCard });
        return ok(state, out.events, out.ledger);
      }
      case 'discard': {
        if (state.phase !== 'meld') return fail('WRONG_PHASE', 'Draw a card before discarding');
        const card = String(a.card ?? '');
        if (!p.hand.includes(card)) return fail('ILLEGAL_DISCARD', `${card} is not in your hand`);
        if (state.pendingWild && p.hand.includes(state.pendingWild)) return fail('ILLEGAL_DISCARD', 'Meld the wildcard you swapped before discarding');
        if (state.mustFinish && p.hand.length !== 1) {
          return fail('ILLEGAL_DISCARD', 'You took the base card — meld everything and discard your last card this turn, or you lose when time runs out');
        }
        if (!p.opened && (state.mustOpen || state.openingProgress > 0)) {
          const thr = state.config.rules.openingThreshold;
          return fail('ILLEGAL_DISCARD', `Lay down ${thr} points before discarding (${state.openingProgress}/${thr}) — otherwise you lose when time runs out`);
        }
        p.missedTurns = 0;
        discardCard(state, index, card, ctx, out);
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
    if (state.phase === 'roundOver') {
      event(state, out, null, 'closed', 'No rematch — table closed');
      finishMatch(state, out);
      return ok(state, out.events, out.ledger);
    }
    const index = state.current;
    const p = state.players[index];
    p.missedTurns += 1;
    out.events.push({ type: 'timeout', playerId: p.playerId, data: { missedTurns: p.missedTurns } });
    if (state.config.rules.timeoutLoses) {
      if (state.baseSetAside) {
        // Timed out while predicting: return the base card so the inventory stays whole.
        state.stock.push(state.baseCard!);
        state.baseSetAside = false;
      }
      event(state, out, p.playerId, 'timeout', 'ran out of time and lost the round');
      endRound(state, 1 - index, 'timeout', ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (p.missedTurns >= state.config.maxMissedTurns) {
      forfeit(state, index, 'missed too many turns', ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (state.phase === 'predict') {
      applyPrediction(state, 'up', ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (state.phase === 'draw') {
      p.hand.push(state.stock.pop()!);
      state.phase = 'meld';
    }
    // A timed-out turn releases any pending obligations.
    state.pendingWild = null;
    state.pendingPickup = null;
    discardCard(state, index, autoDiscardCard(state, p.hand), ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (s) => s.turnDeadline,
  isFinished: (s) => s.phase === 'finished',

  placements(s) {
    if (s.phase !== 'finished') return null;
    const ranked = [...s.players].sort((a, b) => b.roundsWon - a.roundsWon || (a.status === 'left' ? 1 : 0) - (b.status === 'left' ? 1 : 0));
    const tie = ranked[0].roundsWon === ranked[1].roundsWon && ranked.every((p) => p.status === 'active');
    return ranked.map<Placement>((p, i) => ({ playerId: p.playerId, placement: i + 1, outcome: tie ? 'draw' : i === 0 ? 'win' : 'loss' }));
  },

  view(s, viewerId): ConquerView {
    const viewer = s.players.findIndex((p) => p.playerId === viewerId);
    const me = viewer >= 0 ? s.players[viewer] : null;
    const myTurn = me !== null && viewer === s.current && me.status === 'active';
    return {
      game: 'conquer',
      config: s.config,
      unverifiedRules: CONQUER_UNVERIFIED_RULES,
      round: s.round,
      phase: s.phase,
      predictorId: s.players[s.predictor]?.playerId ?? null,
      // The prediction is blind: nobody sees the base card until it is made.
      baseCard: s.phase === 'predict' ? null : s.baseCard,
      baseInStock: s.phase !== 'predict' && s.baseVisible && s.stock.length > 0,
      prediction: s.prediction,
      wildCards: [...s.wildCards],
      wildRanks: [...s.wildRanks],
      wildSuits: s.wildSuits,
      players: s.players.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        handCount: p.hand.length,
        opened: p.opened,
        roundsWon: p.roundsWon,
        missedTurns: p.missedTurns,
        wantsRematch: p.wantsRematch,
        tableCount: s.melds.reduce((n, m) => n + m.placed.filter((x) => x.ownerId === p.playerId).length, 0),
        revealedHand: p.revealedHand,
        penalty: p.penalty,
        status: p.status,
      })),
      hand: me ? [...me.hand] : [],
      pendingWild: myTurn ? s.pendingWild : null,
      pendingPickup: s.phase === 'meld' ? s.pendingPickup : null,
      openingProgress: s.openingProgress,
      mustOpen: s.mustOpen,
      mustFinish: s.mustFinish,
      melds: s.melds.map((m) => ({ id: m.id, ownerId: m.ownerId, kind: m.kind, cards: m.placed.map((x) => ({ ...x })), points: m.placed.reduce((n, x) => n + x.points, 0) })),
      stockCount: s.stock.length,
      discardTop: s.discard[s.discard.length - 1] ?? null,
      discardCount: s.discard.length,
      currentPlayerId: s.phase === 'roundOver' || s.phase === 'finished' ? null : s.players[s.current].playerId,
      turnDeadline: s.turnDeadline,
      lastEvent: s.lastEvent,
      roundResult: s.roundResult,
      legal: {
        predict: myTurn && s.phase === 'predict',
        drawStock: myTurn && s.phase === 'draw',
        takeDiscard: myTurn && s.phase === 'draw' && s.discard.length > 0,
        takeBase: myTurn && s.phase === 'draw' && s.baseVisible && s.stock[0] === s.baseCard,
        meld: myTurn && s.phase === 'meld',
        layoff: myTurn && s.phase === 'meld' && (me!.opened || !s.config.rules.layoffRequiresOpen),
        swapWild: myTurn && s.phase === 'meld' && me!.opened && s.config.rules.wild.allowSwap && !s.pendingWild,
        discard:
          myTurn &&
          s.phase === 'meld' &&
          !(s.pendingWild && me!.hand.includes(s.pendingWild)) &&
          !(s.mustFinish && me!.hand.length !== 1) &&
          !(!me!.opened && (s.mustOpen || s.openingProgress > 0)),
        rematch: me !== null && s.phase === 'roundOver' && !me.wantsRematch && s.players.every((p) => p.status === 'active'),
      },
    };
  },
};

/** Every physical card's location — used by tests to prove nothing is lost or duplicated. */
export function conquerInventory(s: ConquerState): Card[] {
  return [
    ...s.stock,
    ...s.discard,
    ...s.players.flatMap((p) => p.hand),
    ...s.melds.flatMap((m) => m.placed.map((x) => x.card)),
    ...(s.baseSetAside && s.baseCard ? [s.baseCard] : []),
  ];
}

export function isCompleteDeck(cards: Card[], withJokers = true): boolean {
  const deck = new Set(withJokers ? deckWithJokers() : standardDeck());
  return cards.length === deck.size && new Set(cards).size === deck.size && cards.every((c) => deck.has(c));
}
