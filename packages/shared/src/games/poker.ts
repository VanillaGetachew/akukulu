import type { Card } from '../cards';

export interface PokerConfig {
  maxSeats: number;
  /** Buy-in in virtual points; converted 1:1 into table chips. */
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  turnSeconds: number;
  /** Pause between hands so players can see the showdown. */
  handPauseMs: number;
  /** 0 = play until one player holds every chip. */
  maxHands: number;
  /** Consecutive timeouts before a player is removed and cashed out at hand end. */
  maxMissedTurns: number;
  /**
   * 'cash' (default): the buy-in becomes chips and chips go back to points on leaving.
   * 'tournament' (Sit & Go): the buy-in goes into a prize pool, everyone starts with
   * `startingStack` chips, blinds rise every `levelHands` hands, and the last player
   * standing wins; the prize pool is paid by finishing place. Optional for older saves.
   */
  mode?: 'cash' | 'tournament' | 'mtt';
  startingStack?: number;
  levelHands?: number;
  /** Chips every dealt-in player posts before the cards (0/absent = no ante). */
  ante?: number;
  /**
   * Cash: an always-open table. Players sit down with `minBuyIn`–`buyIn` (the
   * maximum) whenever a seat is free, are dealt in from the next hand and stand
   * up — cashing out — whenever they like. The table never finishes.
   */
  permanent?: boolean;
  minBuyIn?: number;
  tableName?: string;
  /** Scheduled multi-table tournament (mode 'mtt'). `buyIn` is the entry fee, paid at registration. */
  tournamentId?: string;
  name?: string;
  /** Minimum prize pool; the house adds the difference when buy-ins fall short. */
  guarantee?: number;
  /** Blind levels last this many minutes. */
  levelMinutes?: number;
  /** Late registration stays open for this many levels after the start. */
  lateRegLevels?: number;
}

/** Sit & Go blind levels (big blinds; the small blind is half). */
export const POKER_TOURNAMENT_BIG_BLINDS = [20, 30, 50, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000] as const;
export const POKER_TOURNAMENT_STACK = 1500;
export const POKER_TOURNAMENT_LEVEL_HANDS = 6;

/** Prize split by finishing place, in percent: winner takes all up to 3 players, 65/35 up to 6, then 50/30/20. */
export function pokerPayoutPercents(entrants: number): number[] {
  if (entrants <= 3) return [100];
  if (entrants <= 6) return [65, 35];
  return [50, 30, 20];
}

/** Prize amounts by place for a pool; rounding leftovers go to the winner. */
export function pokerPayouts(pool: number, entrants: number): number[] {
  const shares = pokerPayoutPercents(entrants).map((p) => Math.floor((pool * p) / 100));
  shares[0] += pool - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/**
 * Scheduled tournaments pay about 15% of the field (at least the Sit & Go places).
 * Shares fall off as 1/place^0.8, so the winner of a 100-player field takes about 24%.
 */
export function pokerMttPayoutPercents(entrants: number): number[] {
  if (entrants <= 9) return pokerPayoutPercents(entrants);
  const paid = Math.max(3, Math.round(entrants * 0.15));
  const weights = Array.from({ length: paid }, (_, i) => 1 / Math.pow(i + 1, 0.8));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * 100);
}

export function pokerMttPayouts(pool: number, entrants: number): number[] {
  const shares = pokerMttPayoutPercents(entrants).map((p) => Math.floor((pool * p) / 100));
  shares[0] += pool - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/** Scheduled-tournament blind level (0-based): the Sit & Go ladder, with antes of a tenth of the big blind from level 4. */
export function pokerMttLevel(level: number): { smallBlind: number; bigBlind: number; ante: number } {
  const bb = POKER_TOURNAMENT_BIG_BLINDS[Math.min(Math.max(0, level), POKER_TOURNAMENT_BIG_BLINDS.length - 1)];
  return { smallBlind: bb / 2, bigBlind: bb, ante: level >= 3 ? Math.max(1, Math.floor(bb / 10)) : 0 };
}

/** Permanent cash tables: blinds per stake level. Buy-in is 40–100 big blinds. */
export const POKER_CASH_STAKES = [
  { smallBlind: 5, bigBlind: 10 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 500, bigBlind: 1000 },
] as const;
export const POKER_CASH_MIN_BB = 40;
export const POKER_CASH_MAX_BB = 100;

export interface PokerTournamentView {
  level: number;
  smallBlind: number;
  bigBlind: number;
  /** The next level's blinds, or null at the last level. */
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
  /** Hands until the blinds go up (counting the current hand). */
  handsToNextLevel: number;
  prizePool: number;
  /** Prize for 1st, 2nd, … place. */
  payouts: number[];
  entrants: number;
  playersLeft: number;
  /** 'sng' (blinds rise by hands) or 'mtt' (scheduled; blinds rise by the clock). */
  kind?: 'sng' | 'mtt';
  name?: string;
  ante?: number;
  nextAnte?: number | null;
  /** MTT: when the current level ends (ms since epoch). */
  levelEndsAt?: number | null;
  startedAt?: number;
  lateRegEndsAt?: number | null;
  tables?: number;
  tableNumber?: number | null;
  stacks?: { min: number; avg: number; max: number };
  /** Viewer's chip rank among players still in, or null. */
  myRank?: number | null;
  /** Viewer's finishing place once out. */
  myPlace?: number | null;
}

export const DEFAULT_POKER_CONFIG: PokerConfig = {
  maxSeats: 6,
  buyIn: 1000,
  smallBlind: 10,
  bigBlind: 20,
  turnSeconds: 25,
  handPauseMs: 5000,
  maxHands: 0,
  maxMissedTurns: 3,
};

export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** amount = total chips committed this street after the bet. */
  | { type: 'bet'; amount: number }
  /** amount = total chips committed this street after the raise ("raise to"). */
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }
  | { type: 'leave' };

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
/** 'waiting': a permanent cash table (or a tournament table) with fewer than two players. */
export type PokerPhase = PokerStreet | 'handComplete' | 'waiting' | 'finished';

export const HAND_CATEGORIES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number] | 'Royal Flush';

export interface PokerPlayerView {
  playerId: string;
  seat: number;
  stack: number;
  committed: number;
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  status: 'active' | 'left' | 'busted';
  inHand: boolean;
  /** The viewer's own cards, or revealed showdown cards; otherwise HIDDEN_CARD placeholders. */
  hole: Card[];
  lastAction: string | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /** Tournament: finishing place once out (or at the end), else null. */
  place: number | null;
  /** Best hand so far ("Two Pair, Aces & Kings"): the viewer's own, or a hand shown down. */
  handLabel?: string | null;
}

export interface PokerLegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  /** Minimum "to" amount for a bet or raise (street commitment). */
  minAmount: number;
  /** Maximum "to" amount (all-in). */
  maxAmount: number;
}

export interface PokerPotResult {
  amount: number;
  winners: string[];
  eligible: string[];
}

export interface PokerShowdownHand {
  playerId: string;
  hole: Card[];
  best: Card[];
  category: HandCategory;
}

export interface PokerHandResult {
  handNumber: number;
  pots: PokerPotResult[];
  showdown: PokerShowdownHand[];
  /** Net chip change per player for the hand. */
  net: Record<string, number>;
  wonWithoutShowdown: boolean;
}

export interface PokerView {
  game: 'poker';
  config: PokerConfig;
  handNumber: number;
  phase: PokerPhase;
  community: Card[];
  pot: number;
  currentBet: number;
  players: PokerPlayerView[];
  currentPlayerId: string | null;
  turnDeadline: number | null;
  nextHandAt: number | null;
  legal: PokerLegalActions | null;
  lastHand: PokerHandResult | null;
  /** Sit & Go details (blind level, prize pool, payouts); null at cash tables. */
  tournament: PokerTournamentView | null;
  /** Permanent cash table: buy-in range and free seats for someone sitting down. */
  cash?: { minBuyIn: number; maxBuyIn: number; freeSeats: number[]; name: string | null } | null;
}

/** One finished hand, as kept in the hand history. */
export interface PokerHandHistory {
  matchId: string;
  handNumber: number;
  at: string;
  tableName: string | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  board: Card[];
  players: {
    playerId: string;
    displayName: string;
    seat: number;
    startStack: number;
    net: number;
    /** Own cards always; opponents' only when shown down. */
    hole: Card[] | null;
    handLabel: string | null;
    button: boolean;
  }[];
  actions: { playerId: string; street: string; action: string }[];
  pots: { amount: number; winners: string[] }[];
}

/** A scheduled tournament in the lobby. */
export interface PokerTournamentSummary {
  id: string;
  name: string;
  status: 'scheduled' | 'running' | 'finished' | 'cancelled';
  startsAt: string;
  buyIn: number;
  guarantee: number;
  prizePool: number;
  startingStack: number;
  levelMinutes: number;
  lateRegLevels: number;
  maxEntrants: number;
  tableSize: number;
  registered: number;
  isRegistered: boolean;
  matchId: string | null;
  /** Registration is open (before the start, or during late registration). */
  canRegister: boolean;
  payouts: number[];
  /** Player still in (or the winner, once finished). */
  playersLeft: number | null;
}

/** A permanent cash table in the lobby. */
export interface PokerCashTableSummary {
  matchId: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  seated: number;
  maxSeats: number;
  seatedHere: boolean;
}
