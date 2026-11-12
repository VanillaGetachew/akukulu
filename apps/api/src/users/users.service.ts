import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ECONOMY } from '@akukulu/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { UserEntity } from '../database/entities';
import { LedgerService } from '../wallet/ledger.service';
import { RewardsService } from '../wallet/rewards.service';
import { GameError, normalizeContactPhone, publicName, telegramIdFromReferral } from '../common/util';

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
    private readonly rewards: RewardsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  findById(id: string): Promise<UserEntity | null> {
    return this.dataSource.getRepository(UserEntity).findOneBy({ id });
  }

  findByTelegramId(telegramId: string): Promise<UserEntity | null> {
    return this.dataSource.getRepository(UserEntity).findOneBy({ telegramId });
  }

  /** Saves the number Telegram shared for this account. */
  async savePhone(telegramId: string, phone: string): Promise<UserEntity> {
    const number = normalizeContactPhone(phone);
    if (!number) throw new GameError('BAD_PHONE', 'That does not look like a phone number');
    const repo = this.dataSource.getRepository(UserEntity);
    const user = await repo.findOneBy({ telegramId });
    if (!user) throw new GameError('NOT_FOUND', 'User not found', 404);
    user.phone = number;
    return repo.save(user);
  }

  /** Makes the admin flag match the configured list, so a removed admin loses it on the next start. */
  async onApplicationBootstrap() {
    const res = await this.dataSource.query(`UPDATE users SET "isAdmin" = ("telegramId"::text = ANY($1::text[])) WHERE "isAdmin" <> ("telegramId"::text = ANY($1::text[]))`, [this.config.adminTelegramIds]);
    const changed = Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
    if (changed) this.logger.warn(`Admin access updated for ${changed} account(s) to match ADMIN_TELEGRAM_IDS`);
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
      if (!user) user = repo.create({ telegramId, balance: 0, phoneRequired: this.config.requirePhone });
      user.firstName = (identity.first_name || 'Player').slice(0, 64);
      user.lastName = identity.last_name?.slice(0, 64) ?? null;
      user.username = identity.username?.slice(0, 64) ?? null;
      user.languageCode = identity.language_code ?? null;
      if (identity.photo_url) user.photoUrl = identity.photo_url;
      user.lastSeenAt = new Date();
      user.isAdmin = this.config.adminTelegramIds.includes(telegramId);
      user = await repo.save(user);

      if (isNew && this.config.paymentsEnabled) {
        await this.recordReferrer(manager, user, startParam);
      } else if (isNew) {
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

  private async recordReferrer(manager: EntityManager, user: UserEntity, startParam: string | null) {
    const referrerTelegramId = startParam?.startsWith('ref_') ? telegramIdFromReferral(startParam.slice(4)) : null;
    if (!referrerTelegramId || referrerTelegramId === user.telegramId) return;
    const referrer = await manager.getRepository(UserEntity).findOneBy({ telegramId: referrerTelegramId });
    if (referrer) await manager.getRepository(UserEntity).update(user.id, { referredById: referrer.id });
  }

  private async applyReferral(manager: EntityManager, user: UserEntity, startParam: string | null) {
    if (!startParam?.startsWith('ref_')) return;
    const referrerTelegramId = telegramIdFromReferral(startParam.slice(4));
    if (!referrerTelegramId || referrerTelegramId === user.telegramId) return;
    const referrer = await manager.getRepository(UserEntity).findOneBy({ telegramId: referrerTelegramId });
    if (!referrer || referrer.isBanned) return;
    await manager.getRepository(UserEntity).update(user.id, { referredById: referrer.id });
    const res = await this.rewards.grant(manager, {
      userId: referrer.id,
      amount: ECONOMY.referralReward,
      type: 'referral',
      description: `Referral reward — ${publicName(user)} joined`,
      key: `referral:${user.id}`,
    });
    this.logger.log(`Referral reward for ${referrer.id} (new user ${user.id}): ${res.status}`);
  }
}
