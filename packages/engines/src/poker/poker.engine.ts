import {
  DEFAULT_POKER_CONFIG,
  HIDDEN_CARD,
  POKER_CASH_MAX_BB,
  POKER_CASH_MIN_BB,
  POKER_TOURNAMENT_BIG_BLINDS,
  POKER_TOURNAMENT_LEVEL_HANDS,
  POKER_TOURNAMENT_STACK,
  pokerPayouts,
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
import { describeHand, evaluateBest } from './hand-evaluator';

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
  /** Sat down at a running cash table: posts a big blind with the next hand (unless in the blinds). */
  postBlind?: boolean;
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
  /** Tournament: players who started (the prize pool is their buy-ins). Missing at cash tables / older saves. */
  entrants?: number;
  /** Actions of the current hand, for the hand history. */
  handLog?: { playerId: string; street: string; action: string }[];
  /** Permanent cash table: how many times each player has sat down (keys the buy-in / cash-out ledger entries). */
  sits?: Record<string, number>;
  /** Table number inside a multi-table tournament. */
  tableId?: number;
}

const isTournament = (state: { config: PokerConfig }) => state.config.mode === 'tournament';
/** A table inside a scheduled multi-table tournament (the tournament wrapper runs it). */
const isMttTable = (state: { config: PokerConfig }) => state.config.mode === 'mtt';
/** Chips are tournament chips, not points: leaving forfeits them and prizes are paid by place. */
const playsForPrizes = (state: { config: PokerConfig }) => isTournament(state) || isMttTable(state);
const isPermanent = (state: { config: PokerConfig }) => state.config.permanent === true;

/** Tournament blind level for a hand number (levels rise every `levelHands` hands). */
function levelFor(config: PokerConfig, handNumber: number): number {
  const per = config.levelHands ?? POKER_TOURNAMENT_LEVEL_HANDS;
  return Math.min(POKER_TOURNAMENT_BIG_BLINDS.length - 1, Math.floor(Math.max(0, handNumber - 1) / per));
}

/**
 * Tournament finishing order: players still in (most chips first), then everyone who
 * is out, the last one out ranked highest.
 */
function tournamentRanking(state: PokerState): PokerSeatState[] {
  const alive = state.players.filter((p) => p.status === 'active').sort((a, b) => b.stack - a.stack);
  const out = state.players.filter((p) => p.status !== 'active').sort((a, b) => (b.exitOrder ?? 0) - (a.exitOrder ?? 0));
  return [...alive, ...out];
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

export function newSeat(playerId: string, seat: number, stack: number): PokerSeatState {
  return {
    playerId,
    seat,
    stack,
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
    handStartStack: stack,
    finalChips: null,
    exitOrder: null,
  };
}

/** Adds a player in seat order. Safe mid-hand: they sit out until the next deal. */
export function insertSeat(state: PokerState, seat: PokerSeatState) {
  let pos = state.players.findIndex((p) => p.seat > seat.seat);
  if (pos < 0) pos = state.players.length;
  const hadPlayers = state.players.length > 0;
  state.players.splice(pos, 0, seat);
  const shift = (i: number | null) => (i !== null && i >= pos ? i + 1 : i);
  if (hadPlayers) state.button = shift(state.button)!;
  state.smallBlindIndex = shift(state.smallBlindIndex);
  state.bigBlindIndex = shift(state.bigBlindIndex);
  state.current = shift(state.current);
}

/** Removes a player between hands; the button stays put so the next hand moves it on as usual. */
export function removeSeatAt(state: PokerState, index: number) {
  if (state.current !== null) throw new Error('removeSeatAt during a betting round');
  state.players.splice(index, 1);
  const n = state.players.length;
  if (n === 0) state.button = 0;
  else if (index < state.button) state.button -= 1;
  else if (index === state.button) state.button = (index - 1 + n) % n;
  state.button %= Math.max(1, n);
  state.smallBlindIndex = null;
  state.bigBlindIndex = null;
}

/** Seats that are free for someone sitting down. */
export function freeSeats(state: PokerState): number[] {
  const taken = new Set(state.players.map((p) => p.seat));
  return Array.from({ length: state.config.maxSeats }, (_, i) => i).filter((i) => !taken.has(i));
}

const seatedWithChips = (state: PokerState) => state.players.filter((p) => p.status === 'active' && p.stack > 0).length;

/** Permanent table between hands: drop players who stood up or went broke, and wait if fewer than two remain. */
function tidyPermanent(state: PokerState, ctx: EngineContext) {
  for (let i = state.players.length - 1; i >= 0; i--) if (state.players[i].status !== 'active') removeSeatAt(state, i);
  if (seatedWithChips(state) < 2) {
    state.phase = 'waiting';
    state.nextHandAt = null;
  } else if (state.phase === 'waiting') {
    state.phase = 'handComplete';
    state.nextHandAt = ctx.now + Math.min(state.config.handPauseMs, 3000);
  }
}

function log(state: PokerState, p: PokerSeatState, action: string) {
  (state.handLog ??= []).push({ playerId: p.playerId, street: state.phase, action });
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
  // Tournament chips are not points: a player who leaves forfeits them (prizes are paid by place).
  if (playsForPrizes(state)) {
    p.stack = 0;
    return;
  }
  if (p.stack > 0) {
    const key = state.sits ? `cashout:${p.playerId}:${state.sits[p.playerId] ?? 1}` : `cashout:${p.playerId}`;
    out.ledger.push({ playerId: p.playerId, amount: p.stack, key, type: 'cashout', description: `Poker cash-out (${reason})` });
  }
  p.stack = 0;
}

function finishMatch(state: PokerState, out: Out) {
  if (isTournament(state)) {
    // Pay the prize pool by finishing place.
    const ranking = tournamentRanking(state);
    const entrants = state.entrants ?? state.players.length;
    const prizes = pokerPayouts(state.config.buyIn * entrants, entrants);
    ranking.forEach((p, i) => {
      const prize = prizes[i] ?? 0;
      if (prize > 0) out.ledger.push({ playerId: p.playerId, amount: prize, key: `prize:${p.playerId}`, type: 'payout', description: `Poker Sit & Go — ${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} place` });
    });
    for (const p of state.players) if (p.status === 'active') p.finalChips = p.stack;
  }
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
  // Players out this hand: those who busted with the smaller starting stack finish lower.
  const leaving = state.players.filter((p) => p.status === 'active' && (p.pendingLeave || p.stack === 0));
  leaving.sort((a, b) => a.handStartStack - b.handStartStack);
  for (const p of leaving) {
    if (p.pendingLeave) {
      cashOut(state, p, out, 'left table');
      p.status = 'left';
    } else {
      p.status = 'busted';
      p.finalChips = 0;
    }
    p.exitOrder = ++state.exits;
  }
  out.events.push({ type: 'hand_complete', data: { handNumber: state.handNumber, net: result.net } });
  out.events.push({ type: 'hand_summary', data: handSummary(state, result) });
  if (isMttTable(state)) {
    // The tournament moves players and starts the next hand.
    state.nextHandAt = ctx.now + state.config.handPauseMs;
    return;
  }
  if (isPermanent(state)) {
    state.nextHandAt = ctx.now + state.config.handPauseMs;
    tidyPermanent(state, ctx);
    return;
  }
  const remaining = state.players.filter((p) => p.status === 'active').length;
  const handLimit = !isTournament(state) && state.config.maxHands > 0 && state.handNumber >= state.config.maxHands;
  if (remaining < 2 || handLimit) {
    finishMatch(state, out);
  } else {
    state.nextHandAt = ctx.now + state.config.handPauseMs;
  }
}

/** What the hand history keeps (hole cards are filtered per viewer when read back). */
function handSummary(state: PokerState, result: PokerHandResult) {
  return {
    handNumber: state.handNumber,
    tableId: state.tableId ?? null,
    tableName: state.config.tableName ?? state.config.name ?? null,
    smallBlind: state.config.smallBlind,
    bigBlind: state.config.bigBlind,
    ante: state.config.ante ?? 0,
    board: [...state.community],
    button: state.players[state.button]?.playerId ?? null,
    seats: state.players
      .filter((p) => p.inHand)
      .map((p) => ({ playerId: p.playerId, seat: p.seat, startStack: p.handStartStack, net: result.net[p.playerId] ?? 0, hole: [...p.hole] })),
    shown: result.showdown.map((h) => ({ playerId: h.playerId, label: describeHand([...h.hole, ...state.community]) })),
    actions: state.handLog ?? [],
    pots: result.pots.map(({ amount, winners }) => ({ amount, winners })),
  };
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
    if (isPermanent(state) || isMttTable(state)) {
      state.phase = 'waiting';
      state.current = null;
      state.turnDeadline = null;
      state.nextHandAt = null;
      return;
    }
    finishMatch(state, out);
    return;
  }
  state.handNumber += 1;
  if (isTournament(state)) {
    // Blinds rise every few hands.
    const bb = POKER_TOURNAMENT_BIG_BLINDS[levelFor(state.config, state.handNumber)];
    state.config = { ...state.config, bigBlind: bb, smallBlind: bb / 2 };
  }
  const onButton = state.players[state.button];
  if (state.handNumber > 1 || !onButton || !eligible(onButton)) {
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
  state.handLog = [];

  // Antes go straight into the pot (they do not count towards calling).
  const ante = state.config.ante ?? 0;
  if (ante > 0) {
    for (const p of state.players) {
      if (!p.inHand) continue;
      const chips = Math.min(ante, p.stack);
      p.stack -= chips;
      p.totalCommitted += chips;
      if (p.stack === 0) p.allIn = true;
      log(state, p, `ante ${chips}`);
    }
  }

  const headsUp = state.players.filter((p) => p.inHand).length === 2;
  const sb = headsUp ? state.button : nextIndex(state, state.button, (p) => p.inHand)!;
  const bb = nextIndex(state, sb, (p) => p.inHand)!;
  state.smallBlindIndex = sb;
  state.bigBlindIndex = bb;
  commit(state.players[sb], state.config.smallBlind);
  state.players[sb].lastAction = 'small blind';
  commit(state.players[bb], state.config.bigBlind);
  state.players[bb].lastAction = 'big blind';
  log(state, state.players[sb], `small blind ${state.players[sb].committed}`);
  log(state, state.players[bb], `big blind ${state.players[bb].committed}`);
  // Someone who sat down at a running cash table posts a big blind to be dealt in.
  state.players.forEach((p, i) => {
    if (!p.postBlind) return;
    p.postBlind = false;
    if (!p.inHand || i === sb || i === bb) return;
    commit(p, state.config.bigBlind);
    p.lastAction = 'posts big blind';
    log(state, p, `posts ${p.committed}`);
  });
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

/** Sitting down at a permanent cash table: buy in for 40–100 big blinds, dealt in from the next hand. */
function sitDown(prev: PokerState, playerId: string, action: unknown, ctx: EngineContext): EngineResult<PokerState> {
  if (!isPermanent(prev)) return fail('NOT_ALLOWED', 'Seats open up only at cash tables');
  const existing = prev.players.find((p) => p.playerId === playerId);
  if (existing?.status === 'active') return fail('ALREADY_SEATED', 'You are already sitting at this table');
  const raw = asRecord(action);
  const min = prev.config.minBuyIn ?? prev.config.bigBlind * POKER_CASH_MIN_BB;
  const max = prev.config.buyIn;
  const buyIn = raw.buyIn;
  if (typeof buyIn !== 'number' || !Number.isInteger(buyIn) || buyIn < min || buyIn > max) {
    return fail('BAD_BUY_IN', `Buy in for ${min}–${max}`);
  }
  if ((ctx.balances[playerId] ?? 0) < buyIn) return fail('INSUFFICIENT_BALANCE', 'You do not have enough points for that buy-in');
  const state = clone(prev);
  const out: Out = { events: [], ledger: [] };
  const others = seatedWithChips(state);
  let p = state.players.find((x) => x.playerId === playerId);
  if (p) {
    // Stood up earlier this hand and not cleared away yet: take the same seat again.
    Object.assign(p, newSeat(playerId, p.seat, buyIn));
  } else {
    const free = freeSeats(state);
    if (!free.length) return fail('TABLE_FULL', 'This table is full');
    const wanted = typeof raw.seat === 'number' && free.includes(raw.seat) ? raw.seat : free[0];
    p = newSeat(playerId, wanted, buyIn);
    insertSeat(state, p);
  }
  // Joining a game in progress costs a big blind, so nobody skips the blinds by sitting down late.
  p.postBlind = others >= 2;
  state.sits = { ...(state.sits ?? {}), [playerId]: (state.sits?.[playerId] ?? 0) + 1 };
  out.ledger.push({ playerId, amount: -buyIn, key: `buyin:${playerId}:${state.sits[playerId]}`, type: 'buyin', description: `Poker buy-in (${state.config.tableName ?? 'cash table'})` });
  out.events.push({ type: 'sit', playerId, data: { buyIn, seat: p.seat } });
  if (state.phase === 'waiting' && seatedWithChips(state) >= 2) {
    state.phase = 'handComplete';
    state.nextHandAt = ctx.now + Math.min(state.config.handPauseMs, 3000);
  }
  return ok(state, out.events, out.ledger);
}

export const pokerEngine: GameEngine<PokerState, PokerConfig, PokerView> = {
  slug: 'poker',

  parseConfig(input, stake) {
    const raw = asRecord(input);
    const c: PokerConfig = { ...DEFAULT_POKER_CONFIG };
    if (raw.maxSeats !== undefined) c.maxSeats = intInRange(raw.maxSeats, 2, 9, 'maxSeats');
    if (raw.mode !== undefined && raw.mode !== 'cash' && raw.mode !== 'tournament') throw new ConfigError('mode must be cash or tournament');
    if (raw.permanent === true) {
      // Always-open cash table at fixed blinds.
      c.mode = 'cash';
      c.permanent = true;
      c.maxSeats = raw.maxSeats !== undefined ? intInRange(raw.maxSeats, 2, 9, 'maxSeats') : 9;
      c.bigBlind = intInRange(raw.bigBlind, 2, 100_000, 'bigBlind');
      c.smallBlind = raw.smallBlind !== undefined ? intInRange(raw.smallBlind, 1, c.bigBlind, 'smallBlind') : Math.max(1, Math.floor(c.bigBlind / 2));
      c.minBuyIn = c.bigBlind * POKER_CASH_MIN_BB;
      c.buyIn = c.bigBlind * POKER_CASH_MAX_BB;
      if (typeof raw.tableName === 'string' && raw.tableName.trim()) c.tableName = raw.tableName.trim().slice(0, 40);
      if (raw.turnSeconds !== undefined) c.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
      return c;
    }
    if (raw.mode === 'tournament') {
      // Sit & Go: the stake is the buy-in (it may be free); chips are tournament chips, not points.
      c.mode = 'tournament';
      c.buyIn = intInRange(stake, 0, 1_000_000, 'buy-in');
      c.startingStack = POKER_TOURNAMENT_STACK;
      c.levelHands = raw.levelHands !== undefined ? intInRange(raw.levelHands, 2, 20, 'levelHands') : POKER_TOURNAMENT_LEVEL_HANDS;
      c.bigBlind = POKER_TOURNAMENT_BIG_BLINDS[0];
      c.smallBlind = c.bigBlind / 2;
      if (raw.turnSeconds !== undefined) c.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
      return c;
    }
    if (stake > 0) c.buyIn = intInRange(stake, 100, 1_000_000, 'buy-in');
    if (raw.bigBlind !== undefined) c.bigBlind = intInRange(raw.bigBlind, 2, c.buyIn, 'bigBlind');
    else c.bigBlind = Math.max(2, Math.floor(c.buyIn / 50));
    c.smallBlind = Math.max(1, Math.floor(c.bigBlind / 2));
    if (c.bigBlind * 10 > c.buyIn) throw new ConfigError('Buy-in must be at least 10 big blinds');
    if (raw.turnSeconds !== undefined) c.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
    if (raw.maxHands !== undefined) c.maxHands = intInRange(raw.maxHands, 0, 500, 'maxHands');
    return c;
  },

  playerLimits: (c) => ({ min: c.permanent ? 0 : 2, max: c.maxSeats }),

  start(players, config, ctx) {
    if (config.permanent) {
      // Opens empty; players sit down with their own buy-in.
      if (players.length) return fail('BAD_PLAYER_COUNT', 'A cash table opens empty');
      return ok<PokerState>({
        config,
        players: [],
        handNumber: 0,
        button: 0,
        smallBlindIndex: null,
        bigBlindIndex: null,
        phase: 'waiting',
        deck: [],
        community: [],
        current: null,
        currentBet: 0,
        minRaise: config.bigBlind,
        turnDeadline: null,
        nextHandAt: null,
        lastHand: null,
        exits: 0,
        sits: {},
      });
    }
    if (players.length < 2 || players.length > config.maxSeats) return fail('BAD_PLAYER_COUNT', `Poker needs 2–${config.maxSeats} players`);
    const out: Out = { events: [], ledger: [] };
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const tournament = config.mode === 'tournament';
    const stack = tournament ? (config.startingStack ?? POKER_TOURNAMENT_STACK) : config.buyIn;
    for (const p of ordered) {
      if ((ctx.balances[p.playerId] ?? 0) < config.buyIn) return fail('INSUFFICIENT_BALANCE', 'A player cannot cover the buy-in');
      if (config.buyIn > 0) {
        out.ledger.push({ playerId: p.playerId, amount: -config.buyIn, key: `buyin:${p.playerId}`, type: 'buyin', description: tournament ? 'Poker Sit & Go buy-in' : 'Poker buy-in' });
      }
    }
    const state: PokerState = {
      config,
      players: ordered.map((p) => newSeat(p.playerId, p.seat, stack)),
      ...(tournament ? { entrants: ordered.length } : {}),
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
    if (actionType(action) === 'sit') return sitDown(prev, playerId, action, ctx);
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
        if (state.phase === 'handComplete' || state.phase === 'waiting' || !p.inHand) {
          cashOut(state, p, out, 'left table');
          p.status = 'left';
          p.exitOrder = ++state.exits;
          if (isPermanent(state)) {
            if (state.current === null) tidyPermanent(state, ctx);
          } else if (!isMttTable(state) && state.players.filter((x) => x.status === 'active').length < 2) finishMatch(state, out);
        }
        return ok(state, out.events, out.ledger);
      }
      p.folded = true;
      p.hasActed = true;
      p.lastAction = 'fold (left)';
      log(state, p, 'fold (left)');
      if (state.current === index || state.players.filter(contending).length === 1) progress(state, index, ctx, out);
      return ok(state, out.events, out.ledger);
    }

    if (!isBettingPhase(state.phase)) return fail('WRONG_PHASE', 'Wait for the next hand');
    if (state.current !== index) return fail('NOT_YOUR_TURN', 'It is not your turn');
    const street = state.phase;
    const error = applyBettingAction(state, index, action, out);
    if (error) return fail(error === 'Unknown action' ? 'UNKNOWN_ACTION' : 'ILLEGAL_ACTION', error);
    p.hasActed = true;
    p.missedTurns = 0;
    (state.handLog ??= []).push({ playerId, street, action: p.lastAction ?? '' });
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
    const street = state.phase;
    applyBettingAction(state, index, { type: legal.canCheck ? 'check' : 'fold' }, out);
    p.lastAction = `${p.lastAction} (timeout)`;
    p.hasActed = true;
    (state.handLog ??= []).push({ playerId: p.playerId, street, action: p.lastAction ?? 'timeout' });
    // In a scheduled tournament a player who keeps timing out is folded every hand rather than removed.
    if (p.missedTurns >= state.config.maxMissedTurns && !isMttTable(state)) p.pendingLeave = true;
    out.events.push({ type: 'timeout', playerId: p.playerId, data: { missedTurns: p.missedTurns } });
    progress(state, index, ctx, out);
    return ok(state, out.events, out.ledger);
  },

  deadline: (s) => (s.phase === 'handComplete' ? s.nextHandAt : s.turnDeadline),
  isFinished: (s) => s.phase === 'finished',

  placements(s) {
    if (s.phase !== 'finished') return null;
    if (isTournament(s)) {
      return tournamentRanking(s).map<Placement>((p, i) => ({ playerId: p.playerId, placement: i + 1, outcome: i === 0 ? 'win' : 'loss' }));
    }
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

  participants: (s) => (isPermanent(s) ? s.players.filter((p) => p.status === 'active').map((p) => p.playerId) : null),
  seatOf: (s, playerId) => s.players.find((p) => p.playerId === playerId)?.seat ?? null,

  view(s, viewerId): PokerView {
    const revealed = new Map<string, Card[]>();
    if ((s.phase === 'handComplete' || s.phase === 'finished' || s.phase === 'showdown') && s.lastHand?.handNumber === s.handNumber) {
      for (const h of s.lastHand.showdown) revealed.set(h.playerId, h.hole);
    }
    const viewerIndex = s.players.findIndex((p) => p.playerId === viewerId);
    // Tournament: blind level, prize pool and finishing places.
    let tournament: PokerView['tournament'] = null;
    const places = new Map<string, number>();
    if (isTournament(s)) {
      const entrants = s.entrants ?? s.players.length;
      const level = levelFor(s.config, Math.max(1, s.handNumber));
      const per = s.config.levelHands ?? POKER_TOURNAMENT_LEVEL_HANDS;
      const nextBb = POKER_TOURNAMENT_BIG_BLINDS[level + 1] ?? null;
      tournamentRanking(s).forEach((p, i) => {
        if (p.status !== 'active' || s.phase === 'finished') places.set(p.playerId, i + 1);
      });
      tournament = {
        level: level + 1,
        smallBlind: s.config.smallBlind,
        bigBlind: s.config.bigBlind,
        nextSmallBlind: nextBb === null ? null : nextBb / 2,
        nextBigBlind: nextBb,
        handsToNextLevel: nextBb === null ? 0 : (level + 1) * per - Math.max(1, s.handNumber) + 1,
        prizePool: s.config.buyIn * entrants,
        payouts: pokerPayouts(s.config.buyIn * entrants, entrants),
        entrants,
        playersLeft: s.players.filter((p) => p.status === 'active').length,
      };
    }
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
        place: places.get(p.playerId) ?? null,
        handLabel:
          p.playerId === viewerId && p.hole.length === 2 && p.inHand
            ? describeHand([...p.hole, ...s.community])
            : revealed.has(p.playerId)
              ? describeHand([...revealed.get(p.playerId)!, ...s.community])
              : null,
      })),
      currentPlayerId: s.current !== null ? s.players[s.current].playerId : null,
      turnDeadline: s.turnDeadline,
      nextHandAt: s.nextHandAt,
      legal: viewerIndex >= 0 ? legalPokerActions(s, viewerIndex) : null,
      lastHand: s.lastHand,
      tournament,
      cash: isPermanent(s)
        ? { minBuyIn: s.config.minBuyIn ?? s.config.bigBlind * POKER_CASH_MIN_BB, maxBuyIn: s.config.buyIn, freeSeats: freeSeats(s), name: s.config.tableName ?? null }
        : null,
    };
  },
};
