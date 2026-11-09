/** Penalty Shootout: one kicker and one keeper each pick a side in secret, turn about. */
export const PENALTY_SIDES = ['left', 'center', 'right'] as const;
export type PenaltySide = (typeof PENALTY_SIDES)[number];

export interface PenaltyConfig {
  /** Entry stake per player; the winner takes the pot. */
  stake: number;
  /** Kicks each in the regular shootout; level after that goes to sudden death. */
  kicks: number;
  turnSeconds: number;
  /** Timed-out choices in a row before a player loses. Each earlier one picks a side at random. */
  maxMissedTurns: number;
  /** Total kicks before a shootout still level is settled by a coin toss, so a match always ends. */
  maxKicks: number;
}

export const DEFAULT_PENALTY_CONFIG: PenaltyConfig = {
  stake: 0,
  kicks: 5,
  turnSeconds: 15,
  maxMissedTurns: 3,
  maxKicks: 40,
};

/** How long a kick plays out on screen; added to the next choice's clock. */
export const PENALTY_REVEAL_MS = 2600;

export type PenaltyAction = { type: 'choose'; side: PenaltySide } | { type: 'leave' };

export type PenaltyKickResult = 'goal' | 'saved';
export type PenaltyPlayerStatus = 'active' | 'forfeited';

export interface PenaltyPlayerView {
  playerId: string;
  seat: number;
  status: PenaltyPlayerStatus;
  goals: number;
  /** This player's kicks so far, in order. */
  kicks: PenaltyKickResult[];
}

export interface PenaltyLastKick {
  /** Counts up with every kick, so a client animates each one once. */
  seq: number;
  kickerId: string;
  keeperId: string;
  aim: PenaltySide;
  dive: PenaltySide;
  goal: boolean;
}

export interface PenaltyView {
  game: 'penalty';
  config: PenaltyConfig;
  phase: 'choosing' | 'finished';
  players: PenaltyPlayerView[];
  kickerId: string;
  keeperId: string;
  suddenDeath: boolean;
  /** Null for spectators. */
  myRole: 'kicker' | 'keeper' | null;
  /** The viewer's own hidden pick for this kick. The opponent's is never sent until it is resolved. */
  myChoice: PenaltySide | null;
  opponentReady: boolean;
  canChoose: boolean;
  turnDeadline: number | null;
  lastKick: PenaltyLastKick | null;
  winnerId: string | null;
  finishReason: 'score' | 'forfeit' | 'coin' | null;
}
