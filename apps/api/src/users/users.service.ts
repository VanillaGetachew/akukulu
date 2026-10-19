import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ECONOMY } from '@akukulu/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { UserEntity } from '../database/entities';
import { LedgerService } from '../wallet/ledger.service';
import { telegramIdFromReferral } from '../common/util';

export interface TelegramIdentity {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  findById(id: string): Promise<UserEntity | null> {
    return this.dataSource.getRepository(UserEntity).findOneBy({ id });
  }

  findByTelegramId(telegramId: string): Promise<UserEntity | null> {
    return this.dataSource.getRepository(UserEntity).findOneBy({ telegramId });
  }

  /**
   * Creates or refreshes a user from a verified Telegram identity. New users get
   * the welcome bonus; a `ref_<code>` start parameter credits the referrer once.
   */
  async upsertFromTelegram(identity: TelegramIdentity, startParam: string | null): Promise<UserEntity> {
    const telegramId = String(identity.id);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(UserEntity);
      let user = await repo.findOne({ where: { telegramId }, lock: { mode: 'pessimistic_write' } });
      const isNew = !user;
      if (!user) user = repo.create({ telegramId, balance: 0 });
      user.firstName = (identity.first_name || 'Player').slice(0, 64);
      user.lastName = identity.last_name?.slice(0, 64) ?? null;
      user.username = identity.username?.slice(0, 64) ?? null;
      user.languageCode = identity.language_code ?? null;
      if (identity.photo_url) user.photoUrl = identity.photo_url;
      user.lastSeenAt = new Date();
      if (this.config.adminTelegramIds.includes(telegramId)) user.isAdmin = true;
      user = await repo.save(user);

      if (isNew) {
        await this.ledger.apply(manager, {
          userId: user.id,
          amount: ECONOMY.welcomeBonus,
          type: 'welcome',
          description: 'Welcome bonus',
          key: `welcome:${user.id}`,
        });
        await this.applyReferral(manager, user, startParam);
        user = (await repo.findOneBy({ id: user.id }))!;
      }
      return user;
    });
  }

  private async applyReferral(manager: EntityManager, user: UserEntity, startParam: string | null) {
    if (!startParam?.startsWith('ref_')) return;
    const referrerTelegramId = telegramIdFromReferral(startParam.slice(4));
    if (!referrerTelegramId || referrerTelegramId === user.telegramId) return;
    const referrer = await manager.getRepository(UserEntity).findOneBy({ telegramId: referrerTelegramId });
    if (!referrer || referrer.isBanned) return;
    await manager.getRepository(UserEntity).update(user.id, { referredById: referrer.id });
    await this.ledger.apply(manager, {
      userId: referrer.id,
      amount: ECONOMY.referralReward,
      type: 'referral',
      description: `Referral reward — ${user.firstName} joined`,
      key: `referral:${user.id}`,
    });
    this.logger.log(`Referral credited to ${referrer.id} for ${user.id}`);
  }
}
