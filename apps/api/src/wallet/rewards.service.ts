import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../config';
import { RewardRequestEntity, UserEntity } from '../database/entities';
import { Broadcaster } from '../realtime/broadcaster';
import { GameError, displayName } from '../common/util';
import { LedgerService } from './ledger.service';

export interface RewardGrant {
  userId: string;
  type: RewardRequestEntity['type'];
  amount: number;
  description: string;
  /** Unique per reward (e.g. daily:<user>:<day>); repeats are ignored. */
  key: string;
}

export interface RewardRequestSummary {
  id: string;
  userId: string;
  displayName: string;
  telegramId: string;
  type: RewardRequestEntity['type'];
  amount: number;
  status: RewardRequestEntity['status'];
  description: string;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/**
 * Rewards are paid only with an administrator's approval (when
 * REWARDS_REQUIRE_APPROVAL is on, the default). A grant becomes a pending
 * request; approving it credits the ledger exactly once.
 */
@Injectable()
export class RewardsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly broadcaster: Broadcaster,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get requiresApproval(): boolean {
    return this.config.rewardsRequireApproval;
  }

  /** Grants a reward: a pending request, or an immediate credit when approval is off. */
  async grant(manager: EntityManager, g: RewardGrant): Promise<{ status: 'pending' | 'paid' | 'duplicate'; balance?: number }> {
    if (!this.requiresApproval) {
      const res = await this.ledger.apply(manager, { userId: g.userId, amount: g.amount, type: g.type === 'daily' ? 'daily_reward' : g.type, description: g.description, key: g.key });
      return res.applied ? { status: 'paid', balance: res.balance } : { status: 'duplicate', balance: res.balance };
    }
    const inserted: { id: string }[] = await manager.query(
      `INSERT INTO reward_requests (id, "userId", type, amount, status, description, key, "createdAt")
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, now())
       ON CONFLICT (key) DO NOTHING RETURNING id`,
      [randomUUID(), g.userId, g.type, g.amount, g.description, g.key],
    );
    return { status: inserted.length ? 'pending' : 'duplicate' };
  }

  async list(status: RewardRequestEntity['status'] | 'all', limit = 100): Promise<RewardRequestSummary[]> {
    const rows = await this.dataSource.getRepository(RewardRequestEntity).find({
      where: status === 'all' ? {} : { status },
      order: { createdAt: status === 'pending' ? 'ASC' : 'DESC' },
      take: limit,
    });
    const users = await this.dataSource.getRepository(UserEntity).findBy({ id: In([...new Set(rows.map((r) => r.userId))]) });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      displayName: byId.get(r.userId) ? displayName(byId.get(r.userId)!) : 'Player',
      telegramId: byId.get(r.userId)?.telegramId ?? '',
      type: r.type,
      amount: r.amount,
      status: r.status,
      description: r.description,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  }

  /** Approves a pending request and credits it — exactly once, even if approved twice concurrently. */
  async approve(id: string, adminId: string): Promise<{ balance: number }> {
    const res = await this.dataSource.transaction(async (manager) => {
      const req = await manager.getRepository(RewardRequestEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!req) throw new GameError('NOT_FOUND', 'Reward request not found', 404);
      if (req.status !== 'pending') throw new GameError('ALREADY_DECIDED', `This reward was already ${req.status}`);
      const credit = await this.ledger.apply(manager, {
        userId: req.userId,
        amount: req.amount,
        type: req.type === 'daily' ? 'daily_reward' : req.type,
        description: `${req.description} (approved)`,
        key: `reward:${req.id}`,
      });
      Object.assign(req, { status: 'approved', decidedBy: adminId, decidedAt: new Date() });
      await manager.getRepository(RewardRequestEntity).save(req);
      return { userId: req.userId, balance: credit.balance };
    });
    this.broadcaster.toUser(res.userId, 'balance:update', { balance: res.balance });
    return { balance: res.balance };
  }

  async reject(id: string, adminId: string, note: string | null): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const req = await manager.getRepository(RewardRequestEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!req) throw new GameError('NOT_FOUND', 'Reward request not found', 404);
      if (req.status !== 'pending') throw new GameError('ALREADY_DECIDED', `This reward was already ${req.status}`);
      Object.assign(req, { status: 'rejected', decidedBy: adminId, decidedAt: new Date(), note });
      await manager.getRepository(RewardRequestEntity).save(req);
    });
  }

  /** Admin deposit of coins into an account, always recorded in the ledger. */
  async deposit(userId: string, amount: number, reason: string, adminId: string, idempotencyKey?: string): Promise<{ balance: number; applied: boolean }> {
    if (!Number.isInteger(amount) || amount <= 0) throw new GameError('BAD_AMOUNT', 'Deposit must be a positive whole number');
    const res = await this.ledger.applyStandalone({
      userId,
      amount,
      type: 'admin_deposit',
      description: `${reason} (deposited by admin ${adminId})`.slice(0, 200),
      key: `deposit:${idempotencyKey ?? randomUUID()}`,
    });
    if (res.applied) this.broadcaster.toUser(userId, 'balance:update', { balance: res.balance });
    return res;
  }

  async pendingFor(userId: string): Promise<number> {
    return this.dataSource.getRepository(RewardRequestEntity).countBy({ userId, status: 'pending' });
  }
}
