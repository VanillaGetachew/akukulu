import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { GameSlug, MatchOutcome, MatchStatus, RoomStatus, RoomVisibility } from '@akukulu/shared';

/** bigint columns come back from pg as strings; ms timestamps fit safely in a JS number. */
const bigintNumber = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('users')
@Check('"balance" >= 0')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true })
  @Column({ type: 'bigint' })
  telegramId: string;
  @Column({ type: 'varchar', nullable: true }) username: string | null;
  @Column({ type: 'varchar' }) firstName: string;
  @Column({ type: 'varchar', nullable: true }) lastName: string | null;
  @Column({ type: 'varchar', nullable: true }) photoUrl: string | null;
  @Column({ type: 'varchar', nullable: true }) languageCode: string | null;
  /** Non-redeemable virtual points. Only LedgerService may change this column. */
  @Column({ type: 'integer', default: 0 }) balance: number;
  @Column({ default: false }) isAdmin: boolean;
  @Column({ default: false }) isBanned: boolean;
  @Column({ type: 'uuid', nullable: true }) referredById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) lastSeenAt: Date | null;
}

@Entity('ledger_entries')
@Index(['userId', 'createdAt'])
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) userId: string;
  /** Signed amount: negative = debit. */
  @Column({ type: 'integer' }) amount: number;
  @Column({ type: 'integer' }) balanceAfter: number;
  @Column({ type: 'varchar' }) type: string;
  @Column({ type: 'varchar' }) description: string;
  /** Globally unique; replaying the same operation is a no-op. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  idempotencyKey: string;
  @Index()
  @Column({ type: 'uuid', nullable: true })
  matchId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('games')
export class GameEntity {
  @PrimaryColumn({ type: 'varchar' }) slug: GameSlug;
  @Column({ type: 'varchar' }) name: string;
  @Column({ type: 'varchar' }) tagline: string;
  @Column({ type: 'text' }) description: string;
  @Column({ type: 'integer' }) minPlayers: number;
  @Column({ type: 'integer' }) maxPlayers: number;
  @Column({ default: false }) solo: boolean;
  @Column({ default: true }) enabled: boolean;
  @Column({ default: false }) maintenance: boolean;
  @Column({ type: 'varchar', nullable: true }) maintenanceMessage: string | null;
  @Column({ type: 'integer', default: 0 }) sortOrder: number;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('rooms')
@Index(['gameSlug', 'status'])
export class RoomEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 8 })
  code: string;
  @Column({ type: 'varchar' }) gameSlug: GameSlug;
  @Column({ type: 'uuid' }) hostId: string;
  @Column({ type: 'varchar' }) visibility: RoomVisibility;
  @Column({ type: 'varchar' }) status: RoomStatus;
  @Column({ type: 'integer' }) minPlayers: number;
  @Column({ type: 'integer' }) maxPlayers: number;
  @Column({ type: 'integer', default: 0 }) stake: number;
  @Column({ type: 'jsonb', default: {} }) config: Record<string, unknown>;
  @Column({ type: 'uuid', nullable: true }) matchId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('room_players')
@Unique(['roomId', 'userId'])
@Unique(['roomId', 'seat'])
export class RoomPlayerEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index()
  @Column({ type: 'uuid' })
  roomId: string;
  @Index()
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'integer' }) seat: number;
  @Column({ default: false }) ready: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) joinedAt: Date;
}

@Entity('matches')
@Index(['status', 'deadline'])
export class MatchEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) roomId: string | null;
  @Column({ type: 'varchar' }) gameSlug: GameSlug;
  @Column({ type: 'varchar' }) status: MatchStatus;
  /** Full internal engine state, including private cards. Never sent to clients. */
  @Column({ type: 'jsonb' }) state: unknown;
  @Column({ type: 'integer', default: 0 }) version: number;
  /** Next engine deadline (ms since epoch), used for timers and crash recovery. */
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber }) deadline: number | null;
  @Column({ type: 'jsonb', nullable: true }) result: unknown;
  @CreateDateColumn({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null;
}

@Entity('match_players')
@Unique(['matchId', 'userId'])
export class MatchPlayerEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index()
  @Column({ type: 'uuid' })
  matchId: string;
  @Index()
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'integer' }) seat: number;
  @Column({ type: 'integer', nullable: true }) placement: number | null;
  @Column({ type: 'varchar', nullable: true }) outcome: MatchOutcome | null;
  @Column({ type: 'integer', default: 0 }) pointsDelta: number;
}

@Entity('match_events')
@Unique(['matchId', 'seq'])
@Unique(['matchId', 'userId', 'clientActionId'])
export class MatchEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) matchId: string;
  @Column({ type: 'integer' }) seq: number;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column({ type: 'varchar' }) type: string;
  @Column({ type: 'jsonb', default: {} }) payload: Record<string, unknown>;
  @Column({ type: 'varchar', nullable: true }) clientActionId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('player_stats')
export class PlayerStatsEntity {
  @PrimaryColumn({ type: 'uuid' }) userId: string;
  @PrimaryColumn({ type: 'varchar' }) gameSlug: GameSlug;
  @Column({ type: 'integer', default: 0 }) played: number;
  @Column({ type: 'integer', default: 0 }) won: number;
  @Column({ type: 'integer', default: 0 }) lost: number;
  @Column({ type: 'integer', default: 0 }) drawn: number;
  @Column({ type: 'integer', default: 0 }) pointsWon: number;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

/** A reward (daily, referral) waiting for an administrator to approve it. */
@Entity('reward_requests')
@Index(['status', 'createdAt'])
export class RewardRequestEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index()
  @Column({ type: 'uuid' })
  userId: string;
  @Column({ type: 'varchar' }) type: 'daily' | 'referral';
  @Column({ type: 'integer' }) amount: number;
  @Column({ type: 'varchar' }) status: 'pending' | 'approved' | 'rejected';
  @Column({ type: 'varchar' }) description: string;
  /** Same uniqueness rule as the ledger: one daily request per user per day, one per referral. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  key: string;
  @Column({ type: 'varchar', nullable: true }) note: string | null;
  @Column({ type: 'uuid', nullable: true }) decidedBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const ENTITIES = [
  RewardRequestEntity,
  UserEntity,
  LedgerEntryEntity,
  GameEntity,
  RoomEntity,
  RoomPlayerEntity,
  MatchEntity,
  MatchPlayerEntity,
  MatchEventEntity,
  PlayerStatsEntity,
];
