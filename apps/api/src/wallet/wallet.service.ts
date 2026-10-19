import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ECONOMY, type LedgerEntrySummary } from '@akukulu/shared';
import { LedgerEntryEntity } from '../database/entities';
import { Broadcaster } from '../realtime/broadcaster';
import { utcDay } from '../common/util';
import { LedgerService } from './ledger.service';

export interface RewardsStatus {
  dailyAmount: number;
  dailyAvailable: boolean;
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
  ) {}

  private nextUtcMidnight(): string {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.toISOString();
  }

  async rewardsStatus(userId: string): Promise<RewardsStatus> {
    const claimed = await this.dataSource.getRepository(LedgerEntryEntity).existsBy({ idempotencyKey: `daily:${userId}:${utcDay()}` });
    const [{ count }] = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM users WHERE "referredById" = $1`, [userId]);
    return {
      dailyAmount: ECONOMY.dailyReward,
      dailyAvailable: !claimed,
      nextDailyAt: this.nextUtcMidnight(),
      referralReward: ECONOMY.referralReward,
      referralsCount: Number(count),
    };
  }

  /** One free reward per UTC day; the idempotency key makes double-claims impossible. */
  async claimDaily(userId: string): Promise<{ claimed: boolean; balance: number; amount: number; nextDailyAt: string }> {
    const res = await this.ledger.applyStandalone({
      userId,
      amount: ECONOMY.dailyReward,
      type: 'daily_reward',
      description: 'Daily free reward',
      key: `daily:${userId}:${utcDay()}`,
    });
    if (res.applied) this.broadcaster.toUser(userId, 'balance:update', { balance: res.balance });
    return { claimed: res.applied, balance: res.balance, amount: ECONOMY.dailyReward, nextDailyAt: this.nextUtcMidnight() };
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
