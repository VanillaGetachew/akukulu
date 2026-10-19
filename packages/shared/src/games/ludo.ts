export const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'] as const;
export type LudoColor = (typeof LUDO_COLORS)[number];

/**
 * Board geometry. A token's position is stored as "progress" relative to its
 * own start square:
 *   -1        in the yard (base)
 *   0..50     on the shared 52-square track (0 = own start square)
 *   51..55    in the colour's private home column
 *   56        home (finished)
 */
export const LUDO = {
  TRACK_LENGTH: 52,
  LAST_TRACK_PROGRESS: 50,
  HOME_COLUMN_START: 51,
  HOME: 56,
  YARD: -1,
  TOKENS_PER_PLAYER: 4,
  START_OFFSET: { red: 0, green: 13, yellow: 26, blue: 39 } as Record<LudoColor, number>,
  /** Absolute track squares where tokens cannot be captured: four start squares + four star squares. */
  SAFE_SQUARES: [0, 8, 13, 21, 26, 34, 39, 47] as readonly number[],
} as const;

/** Colour assignment by player count — two players sit opposite each other. */
export const LUDO_SEAT_COLORS: Record<number, LudoColor[]> = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue'],
};

/** Absolute track index (0..51) for a token on the shared track, else null. */
export function ludoAbsoluteSquare(color: LudoColor, progress: number): number | null {
  if (progress < 0 || progress > LUDO.LAST_TRACK_PROGRESS) return null;
  return (LUDO.START_OFFSET[color] + progress) % LUDO.TRACK_LENGTH;
}

export interface LudoConfig {
  turnSeconds: number;
  /** Consecutive timed-out turns before a player forfeits. */
  maxMissedTurns: number;
  /** Virtual-point entry stake per player. Winner takes the pot. */
  stake: number;
  extraTurnOnCapture: boolean;
  extraTurnOnHome: boolean;
  /** Move automatically when exactly one token can legally move. */
  autoMoveSingle: boolean;
}

export const DEFAULT_LUDO_CONFIG: LudoConfig = {
  turnSeconds: 20,
  maxMissedTurns: 3,
  stake: 0,
  extraTurnOnCapture: true,
  extraTurnOnHome: true,
  autoMoveSingle: true,
};

export type LudoAction = { type: 'roll' } | { type: 'move'; token: number } | { type: 'leave' };

export type LudoPlayerStatus = 'active' | 'forfeited' | 'finished';

export interface LudoPlayerView {
  playerId: string;
  seat: number;
  color: LudoColor;
  status: LudoPlayerStatus;
  tokens: number[];
  missedTurns: number;
}

export interface LudoLastEvent {
  playerId: string;
  kind: 'roll' | 'move' | 'skip' | 'forfeit' | 'timeout';
  die?: number;
  token?: number;
  from?: number;
  to?: number;
  captured?: { playerId: string; token: number }[];
  extraTurn?: boolean;
  reason?: string;
}

export interface LudoView {
  game: 'ludo';
  players: LudoPlayerView[];
  currentPlayerId: string | null;
  phase: 'roll' | 'move' | 'finished';
  die: number | null;
  /** Tokens the current player may move (only populated for the current player). */
  legalTokens: number[];
  consecutiveSixes: number;
  turnDeadline: number | null;
  turn: number;
  winnerId: string | null;
  lastEvent: LudoLastEvent | null;
  config: LudoConfig;
}
