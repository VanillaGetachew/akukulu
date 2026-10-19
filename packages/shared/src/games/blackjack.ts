import type { Card } from '../cards';

export interface BlackjackConfig {
  decks: number;
  /** false = dealer stands on all 17s (S17). true = dealer hits soft 17 (H17). */
  dealerHitsSoft17: boolean;
  /** Natural blackjack payout ratio: 1.5 = 3:2, 1.2 = 6:5. */
  blackjackPayout: number;
  /** 'any' = double on any first two cards; '9-11' / '10-11' = hard totals only. */
  doubleOn: 'any' | '9-11' | '10-11';
  doubleAfterSplit: boolean;
  /** Maximum number of hands a player may hold after splitting. */
  maxHands: number;
  resplitAces: boolean;
  minBet: number;
  maxBet: number;
  /** Fraction of the shoe dealt before it is reshuffled. */
  penetration: number;
  turnSeconds: number;
  /** Seconds between rounds without a bet before the session closes. */
  idleSeconds: number;
}

export const DEFAULT_BLACKJACK_CONFIG: BlackjackConfig = {
  decks: 6,
  dealerHitsSoft17: false,
  blackjackPayout: 1.5,
  doubleOn: 'any',
  doubleAfterSplit: true,
  maxHands: 4,
  resplitAces: false,
  minBet: 10,
  maxBet: 500,
  penetration: 0.75,
  turnSeconds: 30,
  idleSeconds: 180,
};

export type BlackjackAction =
  | { type: 'bet'; amount: number }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' }
  | { type: 'split' }
  | { type: 'leave' };

export type BlackjackHandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface BlackjackHandView {
  cards: Card[];
  bet: number;
  total: number;
  soft: boolean;
  doubled: boolean;
  done: boolean;
  fromSplit: boolean;
  result: BlackjackHandResult | null;
  payout: number | null;
}

export interface BlackjackView {
  game: 'blackjack';
  config: BlackjackConfig;
  phase: 'betting' | 'playerTurn' | 'roundOver' | 'finished';
  round: number;
  hands: BlackjackHandView[];
  activeHand: number | null;
  /** Hole card is HIDDEN_CARD until revealed. */
  dealer: { cards: Card[]; total: number | null; revealed: boolean };
  legal: { hit: boolean; stand: boolean; double: boolean; split: boolean; bet: boolean };
  turnDeadline: number | null;
  shoeRemaining: number;
  lastRoundNet: number | null;
  sessionNet: number;
  totalWagered: number;
}
