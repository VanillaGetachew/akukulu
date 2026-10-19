import type { GameSlug } from './catalog';
import type { LudoView } from './games/ludo';
import type { PokerView } from './games/poker';
import type { BlackjackView } from './games/blackjack';
import type { ConquerView } from './games/conquer';

export type GameView = LudoView | PokerView | BlackjackView | ConquerView;

export interface UserProfile {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  balance: number;
  isAdmin: boolean;
  createdAt: string;
  referralCode: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface GameSummary {
  slug: GameSlug;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  solo: boolean;
  enabled: boolean;
  maintenance: boolean;
  maintenanceMessage: string | null;
  /** Players currently seated in waiting rooms or active matches. */
  activePlayers: number;
  openRooms: number;
  playable: boolean;
  /** Playable, but some rules still await confirmation. */
  beta: boolean;
}

export type RoomStatus = 'waiting' | 'in_progress' | 'finished' | 'cancelled';
export type RoomVisibility = 'public' | 'private';

export interface RoomPlayerSummary {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  seat: number;
  ready: boolean;
}

export interface RoomSummary {
  id: string;
  code: string;
  gameSlug: GameSlug;
  visibility: RoomVisibility;
  status: RoomStatus;
  hostId: string;
  maxPlayers: number;
  minPlayers: number;
  stake: number;
  config: Record<string, unknown>;
  players: RoomPlayerSummary[];
  matchId: string | null;
  inviteLink: string | null;
  createdAt: string;
}

export type MatchStatus = 'active' | 'finished' | 'cancelled';
export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchPlayerSummary {
  userId: string;
  displayName: string;
  seat: number;
  placement: number | null;
  outcome: MatchOutcome | null;
  pointsDelta: number;
}

export interface MatchSummary {
  id: string;
  gameSlug: GameSlug;
  roomCode: string | null;
  status: MatchStatus;
  players: MatchPlayerSummary[];
  startedAt: string;
  endedAt: string | null;
}

export interface LedgerEntrySummary {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  description: string;
  createdAt: string;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  played: number;
  won: number;
  pointsWon: number;
}

export interface PlayerStatsSummary {
  gameSlug: GameSlug;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  pointsWon: number;
}

/* ----- Socket.IO contract ----- */

export interface ActionAck {
  ok: boolean;
  error?: string;
  code?: string;
}

export interface MatchStatePayload {
  matchId: string;
  roomCode: string | null;
  gameSlug: GameSlug;
  status: MatchStatus;
  version: number;
  view: GameView;
  players: { userId: string; displayName: string; photoUrl: string | null; seat: number }[];
  serverTime: number;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomSummary) => void;
  'match:state': (state: MatchStatePayload) => void;
  'match:ended': (summary: MatchSummary) => void;
  'balance:update': (payload: { balance: number }) => void;
  'error': (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  'room:subscribe': (payload: { code: string }, ack: (res: ActionAck & { room?: RoomSummary }) => void) => void;
  'room:unsubscribe': (payload: { code: string }) => void;
  'match:subscribe': (payload: { matchId: string }, ack: (res: ActionAck) => void) => void;
  'match:action': (
    payload: { matchId: string; clientActionId: string; action: Record<string, unknown> },
    ack: (res: ActionAck) => void,
  ) => void;
}
