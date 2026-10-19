import {
  DEFAULT_BLACKJACK_CONFIG,
  HIDDEN_CARD,
  cardRank,
  standardDeck,
  type BlackjackConfig,
  type BlackjackHandResult,
  type BlackjackView,
  type Card,
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
  type Rng,
} from '../core';

export interface BlackjackHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  result: BlackjackHandResult | null;
  payout: number | null;
}

export interface BlackjackState {
  config: BlackjackConfig;
  playerId: string;
  shoe: Card[];
  shoeSize: number;
  round: number;
  phase: 'betting' | 'playerTurn' | 'roundOver' | 'finished';
  hands: BlackjackHand[];
  activeHand: number | null;
  dealer: Card[];
  dealerRevealed: boolean;
  turnDeadline: number | null;
  roundWagered: number;
  lastRoundNet: number | null;
  sessionNet: number;
  totalWagered: number;
  finishReason: string | null;
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

export function cardValue(card: Card): number {
  const r = cardRank(card);
  if (r === 'A') return 11;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (cardRank(c) === 'A') {
      aces++;
      total += 1;
    } else {
      total += cardValue(c);
    }
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export function isNatural(cards: Card[], fromSplit = false): boolean {
  return !fromSplit && cards.length === 2 && handTotal(cards).total === 21;
}

function newShoe(decks: number, rng: Rng): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < decks; i++) cards.push(...standardDeck());
  return shuffle(cards, rng);
}

function draw(state: BlackjackState, rng: Rng): Card {
  if (state.shoe.length === 0) {
    // Only reachable with tiny shoes and many splits; a fresh shoe keeps the round valid.
    state.shoe = newShoe(state.config.decks, rng);
    state.shoeSize = state.shoe.length;
  }
  return state.shoe.pop()!;
}

function canDouble(state: BlackjackState, hand: BlackjackHand, balance: number): boolean {
  if (hand.cards.length !== 2 || hand.done || hand.splitAces) return false;
  if (hand.fromSplit && !state.config.doubleAfterSplit) return false;
  const { total } = handTotal(hand.cards);
  if (state.config.doubleOn === '9-11' && (total < 9 || total > 11)) return false;
  if (state.config.doubleOn === '10-11' && (total < 10 || total > 11)) return false;
  return balance >= hand.bet;
}

function canSplit(state: BlackjackState, hand: BlackjackHand, balance: number): boolean {
  if (hand.cards.length !== 2 || hand.done) return false;
  if (cardValue(hand.cards[0]) !== cardValue(hand.cards[1])) return false;
  if (state.hands.length >= state.config.maxHands) return false;
  if (hand.splitAces && !state.config.resplitAces) return false;
  return balance >= hand.bet;
}

function setTurnDeadline(state: BlackjackState, ctx: EngineContext) {
  if (state.phase === 'playerTurn') state.turnDeadline = ctx.now + state.config.turnSeconds * 1000;
  else if (state.phase === 'finished') state.turnDeadline = null;
  else state.turnDeadline = ctx.now + state.config.idleSeconds * 1000;
}

function settleRound(state: BlackjackState, ctx: EngineContext, out: Out, dealerNatural: boolean) {
  state.dealerRevealed = true;
  const dealer = handTotal(state.dealer);
  let payout = 0;
  for (const hand of state.hands) {
    const player = handTotal(hand.cards);
    const natural = isNatural(hand.cards, hand.fromSplit);
    let result: BlackjackHandResult;
    let paid = 0;
    if (dealerNatural) {
      result = natural ? 'push' : 'lose';
      paid = natural ? hand.bet : 0;
    } else if (natural) {
      result = 'blackjack';
      paid = hand.bet + Math.floor(hand.bet * state.config.blackjackPayout);
    } else if (player.total > 21) {
      result = 'bust';
    } else if (dealer.total > 21 || player.total > dealer.total) {
      result = 'win';
      paid = hand.bet * 2;
    } else if (player.total === dealer.total) {
      result = 'push';
      paid = hand.bet;
    } else {
      result = 'lose';
    }
    hand.result = result;
    hand.payout = paid;
    hand.done = true;
    payout += paid;
  }
  if (payout > 0) {
    out.ledger.push({
      playerId: state.playerId,
      amount: payout,
      key: `r${state.round}:payout`,
      type: 'payout',
      description: `Blackjack round ${state.round} payout`,
    });
  }
  state.lastRoundNet = payout - state.roundWagered;
  state.sessionNet += state.lastRoundNet;
  state.activeHand = null;
  state.phase = 'roundOver';
  setTurnDeadline(state, ctx);
  out.events.push({
    type: 'round_settled',
    playerId: state.playerId,
    data: { round: state.round, payout, net: state.lastRoundNet, results: state.hands.map((h) => h.result) },
  });
}

function playDealer(state: BlackjackState, ctx: EngineContext, out: Out) {
  state.dealerRevealed = true;
  const anyLive = state.hands.some((h) => handTotal(h.cards).total <= 21);
  if (anyLive) {
    for (;;) {
      const { total, soft } = handTotal(state.dealer);
      if (total < 17 || (total === 17 && soft && state.config.dealerHitsSoft17)) {
        state.dealer.push(draw(state, ctx.rng));
      } else {
        break;
      }
    }
  }
  settleRound(state, ctx, out, false);
}

function advance(state: BlackjackState, ctx: EngineContext, out: Out) {
  const next = state.hands.findIndex((h, i) => i >= (state.activeHand ?? 0) && !h.done);
  if (next >= 0) {
    state.activeHand = next;
    setTurnDeadline(state, ctx);
  } else {
    playDealer(state, ctx, out);
  }
}

/** Marks a hand done when it can take no further cards. */
function autoComplete(hand: BlackjackHand) {
  const { total } = handTotal(hand.cards);
  if (total >= 21 || (hand.splitAces && hand.cards.length >= 2)) hand.done = true;
}

function debit(state: BlackjackState, out: Out, amount: number, key: string, description: string) {
  state.roundWagered += amount;
  state.totalWagered += amount;
  out.ledger.push({ playerId: state.playerId, amount: -amount, key: `r${state.round}:${key}`, type: 'bet', description });
}

function placeBet(state: BlackjackState, amount: number, ctx: EngineContext, out: Out) {
  if (state.shoe.length < state.shoeSize * (1 - state.config.penetration)) {
    state.shoe = newShoe(state.config.decks, ctx.rng);
    state.shoeSize = state.shoe.length;
    out.events.push({ type: 'shoe_shuffled' });
  }
  state.round += 1;
  state.roundWagered = 0;
  state.lastRoundNet = null;
  debit(state, out, amount, 'bet', `Blackjack round ${state.round} bet`);

  const hand: BlackjackHand = { cards: [], bet: amount, doubled: false, done: false, fromSplit: false, splitAces: false, result: null, payout: null };
  state.hands = [hand];
  state.dealer = [];
  state.dealerRevealed = false;
  hand.cards.push(draw(state, ctx.rng));
  state.dealer.push(draw(state, ctx.rng));
  hand.cards.push(draw(state, ctx.rng));
  state.dealer.push(draw(state, ctx.rng));
  out.events.push({ type: 'dealt', playerId: state.playerId, data: { round: state.round, bet: amount } });

  // Dealer peeks for blackjack when showing an Ace or ten-value card.
  const upValue = cardValue(state.dealer[0]);
  const dealerNatural = (upValue === 11 || upValue === 10) && isNatural(state.dealer);
  if (dealerNatural || isNatural(hand.cards)) {
    settleRound(state, ctx, out, dealerNatural);
    return;
  }
  state.phase = 'playerTurn';
  state.activeHand = 0;
  setTurnDeadline(state, ctx);
}

function finishSession(state: BlackjackState, reason: string, out: Out) {
  state.phase = 'finished';
  state.turnDeadline = null;
  state.activeHand = null;
  state.finishReason = reason;
  out.events.push({ type: 'session_finished', playerId: state.playerId, data: { reason, net: state.sessionNet } });
}

export const blackjackEngine: GameEngine<BlackjackState, BlackjackConfig, BlackjackView> = {
  slug: 'blackjack',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const c: BlackjackConfig = { ...DEFAULT_BLACKJACK_CONFIG };
    if (raw.decks !== undefined) c.decks = intInRange(raw.decks, 1, 8, 'decks');
    if (raw.dealerHitsSoft17 !== undefined) {
      if (typeof raw.dealerHitsSoft17 !== 'boolean') throw new ConfigError('dealerHitsSoft17 must be boolean');
      c.dealerHitsSoft17 = raw.dealerHitsSoft17;
    }
    if (raw.blackjackPayout !== undefined) {
      if (raw.blackjackPayout !== 1.5 && raw.blackjackPayout !== 1.2) throw new ConfigError('blackjackPayout must be 1.5 (3:2) or 1.2 (6:5)');
      c.blackjackPayout = raw.blackjackPayout;
    }
    if (raw.doubleOn !== undefined) {
      if (!['any', '9-11', '10-11'].includes(raw.doubleOn as string)) throw new ConfigError('doubleOn must be any, 9-11 or 10-11');
      c.doubleOn = raw.doubleOn as BlackjackConfig['doubleOn'];
    }
    if (raw.doubleAfterSplit !== undefined) c.doubleAfterSplit = Boolean(raw.doubleAfterSplit);
    if (raw.maxHands !== undefined) c.maxHands = intInRange(raw.maxHands, 1, 4, 'maxHands');
    if (stake > 0) c.minBet = intInRange(stake, 1, 1_000_000, 'stake');
    if (raw.maxBet !== undefined) c.maxBet = intInRange(raw.maxBet, c.minBet, 1_000_000, 'maxBet');
    // High-stakes tables scale the maximum bet with the minimum.
    c.maxBet = Math.max(c.maxBet, c.minBet * 20);
    return c;
  },

  playerLimits: () => ({ min: 1, max: 1 }),

  start(players, config, ctx) {
    if (players.length !== 1) return fail('BAD_PLAYER_COUNT', 'Blackjack is played by one player against the dealer');
    const shoe = newShoe(config.decks, ctx.rng);
    const state: BlackjackState = {
      config,
      playerId: players[0].playerId,
      shoe,
      shoeSize: shoe.length,
      round: 0,
      phase: 'betting',
      hands: [],
      activeHand: null,
      dealer: [],
      dealerRevealed: false,
      turnDeadline: null,
      roundWagered: 0,
      lastRoundNet: null,
      sessionNet: 0,
      totalWagered: 0,
      finishReason: null,
    };
    setTurnDeadline(state, ctx);
    return ok(state, [{ type: 'started', playerId: state.playerId }]);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'This blackjack session has ended');
    if (playerId !== prev.playerId) return fail('NOT_IN_MATCH', 'You are not seated at this table');
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const balance = ctx.balances[playerId] ?? 0;
    const type = actionType(action);

    if (type === 'leave') {
      if (state.phase === 'playerTurn') {
        for (const h of state.hands) h.done = true;
        playDealer(state, ctx, out);
      }
      finishSession(state, 'left', out);
      return ok(state, out.events, out.ledger);
    }

    if (type === 'bet') {
      if (state.phase !== 'betting' && state.phase !== 'roundOver') return fail('WRONG_PHASE', 'Finish the current round first');
      const amount = asRecord(action).amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount)) return fail('BAD_AMOUNT', 'Bet must be a whole number of points');
      if (amount < state.config.minBet || amount > state.config.maxBet) {
        return fail('BAD_AMOUNT', `Bet must be between ${state.config.minBet} and ${state.config.maxBet}`);
      }
      if (amount > balance) return fail('INSUFFICIENT_BALANCE', 'Not enough points for that bet');
      placeBet(state, amount, ctx, out);
      return ok(state, out.events, out.ledger);
    }

    if (state.phase !== 'playerTurn' || state.activeHand === null) return fail('WRONG_PHASE', 'Place a bet to start a round');
    const hand = state.hands[state.activeHand];

    switch (type) {
      case 'hit': {
        if (hand.splitAces) return fail('ILLEGAL_ACTION', 'Split aces receive one card only');
        hand.cards.push(draw(state, ctx.rng));
        autoComplete(hand);
        break;
      }
      case 'stand':
        hand.done = true;
        break;
      case 'double': {
        if (!canDouble(state, hand, balance)) return fail('ILLEGAL_ACTION', 'You cannot double this hand');
        debit(state, out, hand.bet, `double:${state.activeHand}`, `Blackjack round ${state.round} double down`);
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(draw(state, ctx.rng));
        hand.done = true;
        break;
      }
      case 'split': {
        if (!canSplit(state, hand, balance)) return fail('ILLEGAL_ACTION', 'You cannot split this hand');
        debit(state, out, hand.bet, `split:${state.hands.length}`, `Blackjack round ${state.round} split`);
        const aces = cardRank(hand.cards[0]) === 'A';
        const second: BlackjackHand = {
          cards: [hand.cards.pop()!],
          bet: hand.bet,
          doubled: false,
          done: false,
          fromSplit: true,
          splitAces: aces,
          result: null,
          payout: null,
        };
        hand.fromSplit = true;
        hand.splitAces = aces;
        hand.cards.push(draw(state, ctx.rng));
        second.cards.push(draw(state, ctx.rng));
        autoComplete(hand);
        autoComplete(second);
        state.hands.splice(state.activeHand + 1, 0, second);
        break;
      }
      default:
        return fail('UNKNOWN_ACTION', 'Unknown action');
    }
    out.events.push({ type, playerId, data: { hand: state.activeHand } });
    if (hand.done) advance(state, ctx, out);
    else setTurnDeadline(state, ctx);
    return ok(state, out.events, out.ledger);
  },

  tick(prev, ctx) {
    if (prev.phase === 'finished' || prev.turnDeadline === null || ctx.now < prev.turnDeadline) return null;
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    if (state.phase === 'playerTurn' && state.activeHand !== null) {
      state.hands[state.activeHand].done = true;
      out.events.push({ type: 'timeout_stand', playerId: state.playerId });
      advance(state, ctx, out);
    } else {
      finishSession(state, 'idle', out);
    }
    return ok(state, out.events, out.ledger);
  },

  deadline: (s) => s.turnDeadline,
  isFinished: (s) => s.phase === 'finished',

  placements(s) {
    if (s.phase !== 'finished') return null;
    return [{ playerId: s.playerId, placement: 1, outcome: s.sessionNet > 0 ? 'win' : s.sessionNet < 0 ? 'loss' : 'draw' }];
  },

  view(s, viewerId): BlackjackView {
    const own = viewerId === s.playerId;
    const hand = s.activeHand !== null ? s.hands[s.activeHand] : null;
    const balanceUnknown = Number.POSITIVE_INFINITY; // affordability is re-checked server-side on action
    const dealerCards = s.dealerRevealed ? [...s.dealer] : s.dealer.map((c, i) => (i === 0 ? c : HIDDEN_CARD));
    const playing = own && s.phase === 'playerTurn' && hand !== null;
    return {
      game: 'blackjack',
      config: s.config,
      phase: s.phase,
      round: s.round,
      hands: s.hands.map((h) => {
        const t = handTotal(h.cards);
        return { cards: [...h.cards], bet: h.bet, total: t.total, soft: t.soft, doubled: h.doubled, done: h.done, fromSplit: h.fromSplit, result: h.result, payout: h.payout };
      }),
      activeHand: s.activeHand,
      dealer: {
        cards: dealerCards,
        total: s.dealerRevealed ? handTotal(s.dealer).total : s.dealer.length ? cardValue(s.dealer[0]) : null,
        revealed: s.dealerRevealed,
      },
      legal: {
        hit: playing && !hand!.splitAces,
        stand: playing,
        double: playing && canDouble(s, hand!, balanceUnknown),
        split: playing && canSplit(s, hand!, balanceUnknown),
        bet: own && (s.phase === 'betting' || s.phase === 'roundOver'),
      },
      turnDeadline: s.turnDeadline,
      shoeRemaining: s.shoe.length,
      lastRoundNet: s.lastRoundNet,
      sessionNet: s.sessionNet,
      totalWagered: s.totalWagered,
    };
  },
};
