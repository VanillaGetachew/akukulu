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
  mode?: 'cash' | 'tournament';
  startingStack?: number;
  levelHands?: number;
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
export type PokerPhase = PokerStreet | 'handComplete' | 'finished';

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
}
