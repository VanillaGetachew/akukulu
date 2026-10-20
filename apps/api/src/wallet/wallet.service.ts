import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ECONOMY, type LedgerEntrySummary } from '@akukulu/shared';
import { LedgerEntryEntity, RewardRequestEntity } from '../database/entities';
import { Broadcaster } from '../realtime/broadcaster';
import { utcDay } from '../common/util';
import { LedgerService } from './ledger.service';
import { RewardsService } from './rewards.service';

export interface RewardsStatus {
  dailyAmount: number;
  dailyAvailable: boolean;
  /** Today's daily reward was requested and is waiting for an admin. */
  dailyPending: boolean;
  /** Rewards (daily, referral) waiting for an admin's approval. */
  pendingRewards: number;
  requiresApproval: boolean;
  nextDailyAt: string;
  referralReward: number;
  referralsCount: number;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly broadcaster: Broadcaster,
    private readonly rewards: RewardsService,
  ) {}

  private nextUtcMidnight(): string {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.toISOString();
  }

  async rewardsStatus(userId: string): Promise<RewardsStatus> {
    const key = `daily:${userId}:${utcDay()}`;
    const paid = await this.dataSource.getRepository(LedgerEntryEntity).existsBy({ idempotencyKey: key });
    const request = await this.dataSource.getRepository(RewardRequestEntity).findOneBy({ key });
    const claimed = paid || !!request;
    const [{ count }] = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM users WHERE "referredById" = $1`, [userId]);
    return {
      dailyAmount: ECONOMY.dailyReward,
      dailyAvailable: !claimed,
      dailyPending: request?.status === 'pending',
      pendingRewards: await this.rewards.pendingFor(userId),
      requiresApproval: this.rewards.requiresApproval,
      nextDailyAt: this.nextUtcMidnight(),
      referralReward: ECONOMY.referralReward,
      referralsCount: Number(count),
    };
  }

  /**
   * One daily reward per UTC day. With admin approval on, this files a request
   * (`pending: true`); the unique key makes double claims impossible either way.
   */
  async claimDaily(userId: string): Promise<{ claimed: boolean; pending: boolean; balance: number; amount: number; nextDailyAt: string }> {
    const res = await this.dataSource.transaction((manager) =>
      this.rewards.grant(manager, {
        userId,
        type: 'daily',
        amount: ECONOMY.dailyReward,
        description: 'Daily free reward',
        key: `daily:${userId}:${utcDay()}`,
      }),
    );
    const [{ balance }] = await this.dataSource.query(`SELECT balance FROM users WHERE id = $1`, [userId]);
    if (res.status === 'paid') this.broadcaster.toUser(userId, 'balance:update', { balance: Number(balance) });
    return {
      claimed: res.status !== 'duplicate',
      pending: res.status === 'pending',
      balance: Number(balance),
      amount: ECONOMY.dailyReward,
      nextDailyAt: this.nextUtcMidnight(),
    };
  }

  async transactions(userId: string, limit: number): Promise<LedgerEntrySummary[]> {
    const rows = await this.dataSource.getRepository(LedgerEntryEntity).find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      type: r.type,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
