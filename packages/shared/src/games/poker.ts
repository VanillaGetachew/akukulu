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
}
