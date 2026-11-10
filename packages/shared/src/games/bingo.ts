/**
 * Bingo, 75 balls: every player has a 5×5 card, numbers are called one at a time, and the
 * first card to complete a line wins. Cards are marked and checked by the server, so nobody
 * loses a win to a slow connection; players who finish on the same ball share the pot.
 */
export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
export const BINGO_BALLS = 75;
/** Numbers per column: B is 1–15, I is 16–30, and so on. */
export const BINGO_COLUMN_RANGE = 15;
/** The middle square is free. Stored as 0 on a card. */
export const BINGO_FREE = 0;

/** A card as 25 numbers, row by row. Index 12 is the free square. */
export type BingoCard = number[];

export function bingoLetter(n: number): (typeof BINGO_LETTERS)[number] {
  return BINGO_LETTERS[Math.floor((n - 1) / BINGO_COLUMN_RANGE)];
}

/** The 13 winning lines, as card indexes: five rows, five columns, two diagonals and the four corners. */
export const BINGO_LINES: readonly (readonly number[])[] = [
  ...Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => r * 5 + c)),
  ...Array.from({ length: 5 }, (_, c) => Array.from({ length: 5 }, (_, r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
  [0, 4, 20, 24],
];

/** The first completed line on a card, or null. */
export function bingoWinningLine(card: BingoCard, called: ReadonlySet<number>): readonly number[] | null {
  return BINGO_LINES.find((line) => line.every((i) => card[i] === BINGO_FREE || called.has(card[i]))) ?? null;
}

/** How many more numbers the card needs for its closest line. */
export function bingoToGo(card: BingoCard, called: ReadonlySet<number>): number {
  return Math.min(...BINGO_LINES.map((line) => line.filter((i) => card[i] !== BINGO_FREE && !called.has(card[i])).length));
}

export interface BingoConfig {
  /** Entry stake per player; the winner takes the pot. */
  stake: number;
  /** Seconds before the first ball, when a player may swap their card. */
  readySeconds: number;
  /** Seconds between balls. */
  callSeconds: number;
  /** How many times a player may swap their card before the first ball. */
  maxSwaps: number;
}

export const DEFAULT_BINGO_CONFIG: BingoConfig = {
  stake: 0,
  readySeconds: 12,
  callSeconds: 4,
  maxSwaps: 3,
};

export const BINGO_MAX_PLAYERS = 10;

/** How long the winning ball and line stay on screen before the result. */
export const BINGO_FINISH_MS = 3500;

export type BingoAction = { type: 'swap' } | { type: 'leave' };

export type BingoPlayerStatus = 'active' | 'left';

export interface BingoPlayerView {
  playerId: string;
  seat: number;
  status: BingoPlayerStatus;
  /** Numbers still needed for this player's closest line. */
  toGo: number;
}

export interface BingoWinnerView {
  playerId: string;
  card: BingoCard;
  /** Card indexes of the winning line. */
  line: number[];
  /** This winner's share of the pot, before the house fee. */
  share: number;
}

export interface BingoView {
  game: 'bingo';
  config: BingoConfig;
  phase: 'ready' | 'calling' | 'finished';
  players: BingoPlayerView[];
  pot: number;
  /** Null for spectators. */
  myCard: BingoCard | null;
  swapsLeft: number;
  /** Every ball called so far, in order. */
  called: number[];
  /** When the next ball is called (or the first one, while getting ready). */
  nextCallAt: number | null;
  winners: BingoWinnerView[];
  finishReason: 'bingo' | 'forfeit' | null;
}
