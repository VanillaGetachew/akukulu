import {
  DEFAULT_POKER_CONFIG,
  HIDDEN_CARD,
  standardDeck,
  type Card,
  type PokerConfig,
  type PokerHandResult,
  type PokerLegalActions,
  type PokerPhase,
  type PokerPotResult,
  type PokerShowdownHand,
  type PokerView,
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
import { evaluateBest } from './hand-evaluator';

export interface PokerSeatState {
  playerId: string;
  seat: number;
  stack: number;
  hole: Card[];
  /** Chips committed in the current betting round. */
  committed: number;
  /** Chips committed over the whole hand. */
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last full raise (a short all-in does not reset this). */
  hasActed: boolean;
  inHand: boolean;
  status: 'active' | 'left' | 'busted';
  pendingLeave: boolean;
  missedTurns: number;
  lastAction: string | null;
  handStartStack: number;
  /** Chips cashed out back to points when the player left / match ended. */
  finalChips: number | null;
  /** Order in which the player stopped playing (bust/leave), for placements. */
  exitOrder: number | null;
}

export interface PokerState {
  config: PokerConfig;
  players: PokerSeatState[];
  handNumber: number;
  button: number;
  smallBlindIndex: number | null;
  bigBlindIndex: number | null;
  phase: PokerPhase;
  /** Remaining deck — server-only, never sent to clients. */
  deck: Card[];
  community: Card[];
  current: number | null;
  currentBet: number;
  minRaise: number;
  turnDeadline: number | null;
  nextHandAt: number | null;
  lastHand: PokerHandResult | null;
  exits: number;
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

const STREETS: PokerPhase[] = ['preflop', 'flop', 'turn', 'river'];
const isBettingPhase = (p: PokerPhase) => STREETS.includes(p);

function nextIndex(state: PokerState, from: number, predicate: (p: PokerSeatState) => boolean): number | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (predicate(state.players[idx])) return idx;
  }
  return null;
}

const contending = (p: PokerSeatState) => p.inHand && !p.folded;
const canAct = (p: PokerSeatState) => p.inHand && !p.folded && !p.allIn;

/** Next player who still owes an action this betting round, or null when the round is complete. */
function findNextActor(state: PokerState, from: number): number | null {
  return nextIndex(state, from, (p) => canAct(p) && (!p.hasActed || p.committed < state.currentBet));
}

function commit(p: PokerSeatState, amount: number) {
  const chips = Math.min(amount, p.stack);
  p.stack -= chips;
  p.committed += chips;
  p.totalCommitted += chips;
  if (p.stack === 0) p.allIn = true;
  return chips;
}

export function legalPokerActions(state: PokerState, index: number): PokerLegalActions | null {
  if (!isBettingPhase(state.phase) || state.current !== index) return null;
  const p = state.players[index];
  const toCall = Math.max(0, state.currentBet - p.committed);
  const maxAmount = p.committed + p.stack;
  const canBet = state.currentBet === 0 && p.stack > 0;
  const canRaise = state.currentBet > 0 && !p.hasActed && maxAmount > state.currentBet;
  const minFull = state.currentBet === 0 ? state.config.bigBlind : state.currentBet + state.minRaise;
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, p.stack),
    canBet,
    canRaise,
    minAmount: Math.min(minFull, maxAmount),
    maxAmount,
  };
}

/** Builds main and side pots from each player's total commitment. */
export function buildPots(players: PokerSeatState[]): { amount: number; eligible: string[] }[] {
  const remaining = new Map(players.map((p) => [p.playerId, p.totalCommitted]));
  const pots: { amount: number; eligible: string[] }[] = [];
  for (;;) {
    const contenders = players.filter((p) => contending(p) && remaining.get(p.playerId)! > 0);
    const total = [...remaining.values()].reduce((a, b) => a + b, 0);
    if (total === 0) break;
    if (contenders.length === 0) {
      // Only dead money from folded players remains; it belongs to the last pot.
      if (pots.length) pots[pots.length - 1].amount += total;
      break;
    }
    const level = Math.min(...contenders.map((p) => remaining.get(p.playerId)!));
    let amount = 0;
    for (const [id, r] of remaining) {
      const take = Math.min(r, level);
      amount += take;
      remaining.set(id, r - take);
    }
    const eligible = contenders.map((p) => p.playerId);
    const last = pots[pots.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  return pots;
}

function setActionDeadline(state: PokerState, ctx: EngineContext) {
  state.turnDeadline = state.current === null ? null : ctx.now + state.config.turnSeconds * 1000;
}

function cashOut(state: PokerState, p: PokerSeatState, out: Out, reason: string) {
  if (p.finalChips !== null) return;
  p.finalChips = p.stack;
  if (p.stack > 0) {
    out.ledger.push({ playerId: p.playerId, amount: p.stack, key: `cashout:${p.playerId}`, type: 'cashout', description: `Poker cash-out (${reason})` });
  }
  p.stack = 0;
}

function finishMatch(state: PokerState, out: Out) {
  for (const p of state.players) {
    if (p.status === 'active') cashOut(state, p, out, 'table closed');
  }
  state.phase = 'finished';
  state.current = null;
  state.turnDeadline = null;
  state.nextHandAt = null;
  out.events.push({ type: 'match_finished', data: { finalChips: Object.fromEntries(state.players.map((p) => [p.playerId, p.finalChips])) } });
}

function endHand(state: PokerState, ctx: EngineContext, out: Out, result: PokerHandResult) {
  state.lastHand = result;
  state.current = null;
  state.turnDeadline = null;
  state.phase = 'handComplete';
  for (const p of state.players) {
    if (p.status !== 'active') continue;
    if (p.pendingLeave) {
      cashOut(state, p, out, 'left table');
      p.status = 'left';
      p.exitOrder = ++state.exits;
    } else if (p.stack === 0) {
      p.status = 'busted';
      p.finalChips = 0;
      p.exitOrder = ++state.exits;
    }
  }
  out.events.push({ type: 'hand_complete', data: { handNumber: state.handNumber, net: result.net } });
  const remaining = state.players.filter((p) => p.status === 'active').length;
  const handLimit = state.config.maxHands > 0 && state.handNumber >= state.config.maxHands;
  if (remaining < 2 || handLimit) {
    finishMatch(state, out);
  } else {
    state.nextHandAt = ctx.now + state.config.handPauseMs;
  }
}

function netByPlayer(state: PokerState): Record<string, number> {
  const net: Record<string, number> = {};
  for (const p of state.players) if (p.inHand) net[p.playerId] = p.stack - p.handStartStack;
  return net;
}

function awardUncontested(state: PokerState, ctx: EngineContext, out: Out) {
  const winner = state.players.find(contending)!;
  const amount = state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  winner.stack += amount;
  endHand(state, ctx, out, {
    handNumber: state.handNumber,
    pots: [{ amount, winners: [winner.playerId], eligible: [winner.playerId] }],
    showdown: [],
    net: netByPlayer(state),
    wonWithoutShowdown: true,
  });
}

function showdown(state: PokerState, ctx: EngineContext, out: Out) {
  state.phase = 'showdown';
  const evaluated = new Map(
    state.players.filter(contending).map((p) => [p.playerId, evaluateBest([...p.hole, ...state.community])]),
  );
  // Odd chips go to winners closest to the left of the button.
  const n = state.players.length;
  const distance = (id: string) => {
    const idx = state.players.findIndex((p) => p.playerId === id);
    return (idx - state.button - 1 + n) % n;
  };
  const pots: PokerPotResult[] = [];
  for (const pot of buildPots(state.players)) {
    const top = Math.max(...pot.eligible.map((id) => evaluated.get(id)!.score));
    const winners = pot.eligible.filter((id) => evaluated.get(id)!.score === top).sort((a, b) => distance(a) - distance(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const id of winners) {
      const p = state.players.find((x) => x.playerId === id)!;
      p.stack += share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
    }
    pots.push({ amount: pot.amount, winners, eligible: pot.eligible });
  }
  const shown: PokerShowdownHand[] = [...evaluated.entries()].map(([playerId, hand]) => ({
    playerId,
    hole: [...state.players.find((p) => p.playerId === playerId)!.hole],
    best: hand.best,
    category: hand.category,
  }));
  out.events.push({ type: 'showdown', data: { pots, shown: shown.map((s) => ({ playerId: s.playerId, category: s.category })) } });
  endHand(state, ctx, out, { handNumber: state.handNumber, pots, showdown: shown, net: netByPlayer(state), wonWithoutShowdown: false });
}

function dealStreet(state: PokerState) {
  state.deck.pop(); // burn
  const count = state.community.length === 0 ? 3 : 1;
  for (let i = 0; i < count; i++) state.community.push(state.deck.pop()!);
}

function advanceStreet(state: PokerState, ctx: EngineContext, out: Out) {
  for (;;) {
    for (const p of state.players) {
      p.committed = 0;
      p.hasActed = false;
    }
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;
    if (state.phase === 'river') {
      showdown(state, ctx, out);
      return;
    }
    state.phase = STREETS[STREETS.indexOf(state.phase) + 1];
    dealStreet(state);
    out.events.push({ type: 'street', data: { phase: state.phase, community: [...state.community] } });
    if (state.players.filter(canAct).length >= 2) {
      state.current = findNextActor(state, state.button);
      setActionDeadline(state, ctx);
      return;
    }
    // Everyone (or all but one) is all-in: run the board out.
  }
}

function progress(state: PokerState, from: number, ctx: EngineContext, out: Out) {
  if (state.players.filter(contending).length === 1) {
    awardUncontested(state, ctx, out);
    return;
  }
  const next = findNextActor(state, from);
  if (next !== null) {
    state.current = next;
    setActionDeadline(state, ctx);
  } else {
    state.current = null;
    advanceStreet(state, ctx, out);
  }
}

function startHand(state: PokerState, ctx: EngineContext, out: Out) {
  const eligible = (p: PokerSeatState) => p.status === 'active' && p.stack > 0;
  if (state.players.filter(eligible).length < 2) {
    finishMatch(state, out);
    return;
  }
  state.handNumber += 1;
  if (state.handNumber > 1 || !eligible(state.players[state.button])) {
    state.button = nextIndex(state, state.button, eligible)!;
  }
  for (const p of state.players) {
    p.inHand = eligible(p);
    p.hole = [];
    p.committed = 0;
    p.totalCommitted = 0;
    p.folded = false;
    p.allIn = false;
    p.hasActed = false;
    p.lastAction = null;
    p.handStartStack = p.stack;
  }
  state.community = [];
  state.deck = shuffle(standardDeck(), ctx.rng);
  state.nextHandAt = null;
  state.phase = 'preflop';

  const headsUp = state.players.filter((p) => p.inHand).length === 2;
  const sb = headsUp ? state.button : nextIndex(state, state.button, (p) => p.inHand)!;
  const bb = nextIndex(state, sb, (p) => p.inHand)!;
  state.smallBlindIndex = sb;
  state.bigBlindIndex = bb;
  commit(state.players[sb], state.config.smallBlind);
  state.players[sb].lastAction = 'small blind';
  commit(state.players[bb], state.config.bigBlind);
  state.players[bb].lastAction = 'big blind';
  state.currentBet = state.config.bigBlind;
  state.minRaise = state.config.bigBlind;

  for (let round = 0; round < 2; round++) {
    let idx = sb;
    do {
      if (state.players[idx].inHand) state.players[idx].hole.push(state.deck.pop()!);
      idx = (idx + 1) % state.players.length;
    } while (idx !== sb);
  }
  out.events.push({ type: 'hand_started', data: { handNumber: state.handNumber, button: state.players[state.button].playerId } });
  progress(state, bb, ctx, out);
}

function applyBettingAction(state: PokerState, index: number, action: unknown, out: Out): string | null {
  const p = state.players[index];
  const legal = legalPokerActions(state, index)!;
  const type = actionType(action);
  const amountRaw = asRecord(action).amount;

  const raiseTo = (amount: number) => {
    const increase = amount - state.currentBet;
    commit(p, amount - p.committed);
    if (increase >= state.minRaise) {
      state.minRaise = increase;
      for (const other of state.players) if (other !== p) other.hasActed = false;
    }
    state.currentBet = Math.max(state.currentBet, amount);
  };
  const validAmount = (a: unknown): a is number => typeof a === 'number' && Number.isInteger(a);

  switch (type) {
    case 'fold':
      p.folded = true;
      p.lastAction = 'fold';
      return null;
    case 'check':
      if (!legal.canCheck) return 'You cannot check while facing a bet';
      p.lastAction = 'check';
      return null;
    case 'call':
      if (legal.canCheck) return 'There is nothing to call';
      commit(p, legal.callAmount);
      p.lastAction = p.allIn ? 'call (all-in)' : 'call';
      return null;
    case 'bet': {
      if (!legal.canBet) return 'You cannot bet now';
      if (!validAmount(amountRaw)) return 'Bet amount must be a whole number';
      if (amountRaw > legal.maxAmount) return 'You do not have that many chips';
      if (amountRaw < legal.minAmount) return `Minimum bet is ${legal.minAmount}`;
      raiseTo(amountRaw);
      p.lastAction = p.allIn ? `all-in ${amountRaw}` : `bet ${amountRaw}`;
      return null;
    }
    case 'raise': {
      if (!legal.canRaise) return state.currentBet === 0 ? 'Nothing to raise — bet instead' : 'Betting has not been reopened; call or fold';
      if (!validAmount(amountRaw)) return 'Raise amount must be a whole number';
      if (amountRaw > legal.maxAmount) return 'You do not have that many chips';
      if (amountRaw < legal.minAmount && amountRaw !== legal.maxAmount) return `Minimum raise is to ${legal.minAmount}`;
      if (amountRaw <= state.currentBet) return 'A raise must exceed the current bet';
      raiseTo(amountRaw);
      p.lastAction = p.allIn ? `all-in ${amountRaw}` : `raise to ${amountRaw}`;
      return null;
    }
    case 'allIn': {
      const total = legal.maxAmount;
      if (total <= state.currentBet) {
        commit(p, p.stack);
        p.lastAction = 'call (all-in)';
      } else if (legal.canBet || legal.canRaise) {
        raiseTo(total);
        p.lastAction = `all-in ${total}`;
      } else {
        return 'Betting has not been reopened; call or fold';
      }
      return null;
    }
    default:
      return 'Unknown action';
  }
}

export const pokerEngine: GameEngine<PokerState, PokerConfig> = {
  slug: 'poker',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const c: PokerConfig = { ...DEFAULT_POKER_CONFIG };
    if (raw.maxSeats !== undefined) c.maxSeats = intInRange(raw.maxSeats, 2, 9, 'maxSeats');
    if (stake > 0) c.buyIn = intInRange(stake, 100, 1_000_000, 'buy-in');
    if (raw.bigBlind !== undefined) c.bigBlind = intInRange(raw.bigBlind, 2, c.buyIn, 'bigBlind');
    else c.bigBlind = Math.max(2, Math.floor(c.buyIn / 50));
    c.smallBlind = Math.max(1, Math.floor(c.bigBlind / 2));
    if (c.bigBlind * 10 > c.buyIn) throw new ConfigError('Buy-in must be at least 10 big blinds');
    if (raw.turnSeconds !== undefined) c.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
    if (raw.maxHands !== undefined) c.maxHands = intInRange(raw.maxHands, 0, 500, 'maxHands');
    return c;
  },

  playerLimits: (c) => ({ min: 2, max: c.maxSeats }),

  start(players, config, ctx) {
    if (players.length < 2 || players.length > config.maxSeats) return fail('BAD_PLAYER_COUNT', `Poker needs 2–${config.maxSeats} players`);
    const out: Out = { events: [], ledger: [] };
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    for (const p of ordered) {
      if ((ctx.balances[p.playerId] ?? 0) < config.buyIn) return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the buy-in');
      out.ledger.push({ playerId: p.playerId, amount: -config.buyIn, key: `buyin:${p.playerId}`, type: 'buyin', description: "Poker buy-in" });
    }
    const state: PokerState = {
      config,
      players: ordered.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        stack: config.buyIn,
        hole: [],
        committed: 0,
        totalCommitted: 0,
        folded: false,
        allIn: false,
        hasActed: false,
        inHand: false,
        status: 'active',
        pendingLeave: false,
        missedTurns: 0,
        lastAction: null,
        handStartStack: config.buyIn,
        finalChips: null,
        exitOrder: null,
      })),
      handNumber: 0,
      button: ctx.rng.int(ordered.length),
      smallBlindIndex: null,
      bigBlindIndex: null,
      phase: 'preflop',
      deck: [],
      community: [],
      current: null,
      currentBet: 0,
      minRaise: config.bigBlind,
      turnDeadline: null,
      nextHandAt: null,
      lastHand: null,
      exits: 0,
    };
    startHand(state, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  act(prev, playerId, action, ctx) {
    if (prev.phase === 'finished') return fail('GAME_OVER', 'The table has closed');
    const index = prev.players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return fail('NOT_IN_MATCH', 'You are not seated at this table');
    if (prev.players[index].status !== 'active') return fail('NOT_ACTIVE', 'You are no longer seated');
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const p = state.players[index];

    if (actionType(action) === 'leave') {
      p.pendingLeave = true;
      out.events.push({ type: 'leave', playerId });
      if (!isBettingPhase(state.phase) || !p.inHand || p.folded) {
        if (state.phase === 'handComplete' || !p.inHand) {
          cashOut(state, p, out, 'left table');
          p.status = 'left';
          p.exitOrder = ++state.exits;
          if (state.players.filter((x) => x.status === 'active').length < 2) finishMatch(state, out);
        }
        return ok(state, out.events, out.ledger);
      }
      p.folded = true;
      p.hasActed = true;
      p.lastAction = 'fold (left)';
      if (state.current === index || state.players.filter(contending).length === 1) progress(state, index, ctx, out);
      return ok(state, out.events, out.ledger);
    }

    if (!isBettingPhase(state.phase)) return fail('WRONG_PHASE', 'Wait for the next hand');
    if (state.current !== index) return fail('NOT_YOUR_TURN', 'It is not your turn');
    const error = applyBettingAction(state, index, action, out);
    if (error) return fail(error === 'Unknown action' ? 'UNKNOWN_ACTION' : 'ILLEGAL_ACTION', error);
    p.hasActed = true;
    p.missedTurns = 0;
    out.events.push({ type: 'action', playerId, data: { action: p.lastAction, phase: state.phase } });
    progress(state, index, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  tick(prev, ctx) {
    if (prev.phase === 'handComplete') {
      if (prev.nextHandAt === null || ctx.now < prev.nextHandAt) return null;
      const state = clone(prev);
      const out: Out = { events: [], ledger: [] };
      startHand(state, ctx, out);
      return ok(state, out.events, out.ledger);
    }
    if (!isBettingPhase(prev.phase) || prev.current === null || prev.turnDeadline === null || ctx.now < prev.turnDeadline) return null;
    const state = clone(prev);
    const out: Out = { events: [], ledger: [] };
    const index = state.current!;
    const p = state.players[index];
    p.missedTurns += 1;
    const legal = legalPokerActions(state, index)!;
    applyBettingAction(state, index, { type: legal.canCheck ? 'check' : 'fold' }, out);
    p.lastAction = `${p.lastAction} (timeout)`;
    p.hasActed = true;
    if (p.missedTurns >= state.config.maxMissedTurns) p.pendingLeave = true;
    out.events.push({ type: 'timeout', playerId: p.playerId, data: { missedTurns: p.missedTurns } });
    progress(state, index, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (s) => (s.phase === 'handComplete' ? s.nextHandAt : s.turnDeadline),
  isFinished: (s) => s.phase === 'finished',

  placements(s) {
    if (s.phase !== 'finished') return null;
    const ranked = [...s.players].sort(
      (a, b) => (b.finalChips ?? 0) - (a.finalChips ?? 0) || (b.exitOrder ?? Infinity) - (a.exitOrder ?? Infinity),
    );
    const top = ranked[0].finalChips ?? 0;
    const topCount = ranked.filter((p) => (p.finalChips ?? 0) === top).length;
    return ranked.map<Placement>((p, i) => ({
      playerId: p.playerId,
      placement: i + 1,
      outcome: (p.finalChips ?? 0) === top ? (topCount === 1 ? 'win' : 'draw') : 'loss',
    }));
  },

  view(s, viewerId): PokerView {
    const revealed = new Map<string, Card[]>();
    if ((s.phase === 'handComplete' || s.phase === 'finished' || s.phase === 'showdown') && s.lastHand?.handNumber === s.handNumber) {
      for (const h of s.lastHand.showdown) revealed.set(h.playerId, h.hole);
    }
    const viewerIndex = s.players.findIndex((p) => p.playerId === viewerId);
    return {
      game: 'poker',
      config: s.config,
      handNumber: s.handNumber,
      phase: s.phase,
      community: [...s.community],
      // Once a hand completes the chips have been pushed to the winners.
      pot: s.phase === 'handComplete' || s.phase === 'finished' ? 0 : s.players.reduce((sum, p) => sum + p.totalCommitted, 0),
      currentBet: s.currentBet,
      players: s.players.map((p, i) => ({
        playerId: p.playerId,
        seat: p.seat,
        stack: p.stack,
        committed: p.committed,
        totalCommitted: p.totalCommitted,
        folded: p.folded,
        allIn: p.allIn,
        status: p.status,
        inHand: p.inHand,
        hole:
          p.playerId === viewerId
            ? [...p.hole]
            : revealed.get(p.playerId) ?? p.hole.map(() => HIDDEN_CARD),
        lastAction: p.lastAction,
        isButton: i === s.button,
        isSmallBlind: i === s.smallBlindIndex,
        isBigBlind: i === s.bigBlindIndex,
      })),
      currentPlayerId: s.current !== null ? s.players[s.current].playerId : null,
      turnDeadline: s.turnDeadline,
      nextHandAt: s.nextHandAt,
      legal: viewerIndex >= 0 ? legalPokerActions(s, viewerIndex) : null,
      lastHand: s.lastHand,
    };
  },
};
