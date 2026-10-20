import type { Card, Suit } from '../cards';

/** House rules for Crazy (Crazy Eights). Defaults follow the classic game plus the popular stacking draw-two. */
export interface CrazyRules {
  /** 8s are wild: play one on anything and name the next suit. */
  eightsWild: boolean;
  /** A 2 makes the next player draw two cards and lose their turn. */
  drawTwo: boolean;
  /** A player facing a draw-two may answer with their own 2 and pass the total on. */
  stackDrawTwo: boolean;
  /** Draws allowed per turn before passing (0 = draw until you can play). */
  maxDraws: number;
  /** Cards dealt to each player in a two-player game, and with three or more. */
  handSizeTwoPlayers: number;
  handSizeMorePlayers: number;
}

export const DEFAULT_CRAZY_RULES: CrazyRules = {
  eightsWild: true,
  drawTwo: true,
  stackDrawTwo: true,
  maxDraws: 3,
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
  | { type: 'play'; card: Card; suit?: Suit }
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
  /** Penalty points left in hand at the end (8 = 50, K Q J 10 = 10, A = 1, others face value). */
  points: number | null;
}

export interface CrazyLastEvent {
  playerId: string;
  kind: 'play' | 'draw' | 'pass' | 'penalty' | 'timeout' | 'forfeit' | 'reshuffle';
  card?: Card;
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
  /** The suit to follow: the top card's suit, or the suit named with an 8. */
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
