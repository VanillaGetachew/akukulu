import type { Card, Rank, Suit } from '../cards';

/** House rules for Crazy (Crazy Eights). Defaults are the Akukulu table rules (owner-confirmed). */
export interface CrazyRules {
  /** Wild ranks (8 and J): play one on anything and name the next suit. */
  wildRanks: Rank[];
  /** A 2 makes the next player draw two cards and lose their turn. */
  drawTwo: boolean;
  /** A player facing a draw-two may answer with their own 2 and pass the total on. */
  stackDrawTwo: boolean;
  /** This rank skips the next player (null = off). With two players you play again. */
  skipRank: Rank | null;
  /** This rank may carry more cards of its own suit, dropped together in one play (null = off). */
  carryRank: Rank | null;
  /** Draws allowed per turn (0 = draw until you can play). */
  maxDraws: number;
  /** Draws needed before a player may pass. */
  passAfterDraws: number;
  /** Cards dealt to each player in a two-player game, and with three or more. */
  handSizeTwoPlayers: number;
  handSizeMorePlayers: number;
}

export const DEFAULT_CRAZY_RULES: CrazyRules = {
  wildRanks: ['8', 'J'],
  drawTwo: true,
  stackDrawTwo: true,
  skipRank: '5',
  carryRank: '7',
  maxDraws: 3,
  passAfterDraws: 1,
  handSizeTwoPlayers: 7,
  handSizeMorePlayers: 5,
};

export interface CrazyConfig {
  rules: CrazyRules;
  /** Entry stake per player; the winner takes the pot. */
  stake: number;
  turnSeconds: number;
  /** Consecutive timed-out turns before a player forfeits. */
  maxMissedTurns: number;
}

export const DEFAULT_CRAZY_CONFIG: CrazyConfig = {
  rules: DEFAULT_CRAZY_RULES,
  stake: 0,
  turnSeconds: 30,
  maxMissedTurns: 3,
};

export const CRAZY_MIN_PLAYERS = 2;
export const CRAZY_MAX_PLAYERS = 5;

export type CrazyAction =
  /** carry: with a 7, more cards of its suit dropped with it in this order; the last card's effect applies. */
  | { type: 'play'; card: Card; suit?: Suit; carry?: Card[] }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'leave' };

export type CrazyPlayerStatus = 'active' | 'forfeited';

export interface CrazyPlayerView {
  playerId: string;
  seat: number;
  status: CrazyPlayerStatus;
  handCount: number;
  missedTurns: number;
  /** Shown to everyone once the game is over. */
  revealedHand: Card[] | null;
  /** Penalty points left in hand at the end (wild 8 / J = 50, K Q 10 = 10, A = 1, others face value). */
  points: number | null;
}

export interface CrazyLastEvent {
  playerId: string;
  kind: 'play' | 'draw' | 'pass' | 'penalty' | 'timeout' | 'forfeit' | 'reshuffle';
  card?: Card;
  /** Every card dropped in a carried play (7 first). */
  cards?: Card[];
  /** The player skipped by a 5. */
  skipped?: string;
  suit?: Suit;
  count?: number;
}

export type CrazyFinishReason = 'out' | 'blocked' | 'forfeit';

export interface CrazyView {
  game: 'crazy';
  players: CrazyPlayerView[];
  /** The viewer's own hand (empty for spectators). */
  hand: Card[];
  currentPlayerId: string | null;
  phase: 'play' | 'finished';
  topCard: Card;
  /** The suit to follow: the top card's suit, or the suit named with a wild card. */
  activeSuit: Suit;
  /** Cards the next draw must take because of stacked 2s (0 when none). */
  pendingDraw: number;
  discardCount: number;
  /** The last few discards, oldest first, for the tossed pile. */
  discardRecent: Card[];
  stockCount: number;
  drawsThisTurn: number;
  turnDeadline: number | null;
  turn: number;
  winnerId: string | null;
  finishReason: CrazyFinishReason | null;
  lastEvent: CrazyLastEvent | null;
  /** The viewer's legal moves (empty when it is not their turn). */
  legal: { play: Card[]; draw: boolean; pass: boolean };
  config: CrazyConfig;
}
