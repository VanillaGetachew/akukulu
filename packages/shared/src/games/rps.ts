/** Rock Paper Scissors: both players throw in secret at the same time; first to the target wins. */
export const RPS_HANDS = ['rock', 'paper', 'scissors'] as const;
export type RpsHand = (typeof RPS_HANDS)[number];

/** What each hand beats. */
export const RPS_BEATS: Record<RpsHand, RpsHand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export interface RpsConfig {
  /** Entry stake per player; the winner takes the pot. */
  stake: number;
  /** Round wins needed to take the match. Draws are replayed. */
  winsNeeded: number;
  turnSeconds: number;
  /** Timed-out throws in a row before a player loses. Each earlier one throws a hand at random. */
  maxMissedTurns: number;
  /** Total rounds before a match still undecided is settled by a coin toss, so a match always ends. */
  maxRounds: number;
}

export const DEFAULT_RPS_CONFIG: RpsConfig = {
  stake: 0,
  winsNeeded: 3,
  turnSeconds: 10,
  maxMissedTurns: 3,
  maxRounds: 30,
};

/** How long a throw plays out on screen; added to the next round's clock. */
export const RPS_REVEAL_MS = 2600;

export type RpsAction = { type: 'throw'; hand: RpsHand } | { type: 'leave' };

export type RpsPlayerStatus = 'active' | 'forfeited';
export type RpsRoundResult = 'win' | 'loss' | 'draw';

export interface RpsPlayerView {
  playerId: string;
  seat: number;
  status: RpsPlayerStatus;
  wins: number;
}

export interface RpsLastRound {
  /** Counts up with every round, so a client animates each one once. */
  seq: number;
  /** Each player's hand, by player id. */
  hands: Record<string, RpsHand>;
  /** Null for a draw. */
  winnerId: string | null;
}

export interface RpsView {
  game: 'rps';
  config: RpsConfig;
  phase: 'choosing' | 'finished';
  players: RpsPlayerView[];
  /** Rounds played so far, draws included. */
  round: number;
  /** The viewer's own hidden throw for this round. The opponent's is never sent until both are in. */
  myHand: RpsHand | null;
  opponentReady: boolean;
  canThrow: boolean;
  turnDeadline: number | null;
  lastRound: RpsLastRound | null;
  winnerId: string | null;
  finishReason: 'score' | 'forfeit' | 'coin' | null;
}
