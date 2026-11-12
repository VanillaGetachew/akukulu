import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  PAYMENTS,
  PROMOTIONS,
  TRANSFERS,
  transferFee,
  type TransferPreview,
  type TransferResult,
  paymentButtons,
  paymentDecisionText,
  paymentRequestText,
  type PaymentAccountSummary,
  type PaymentRequestSummary,
} from '@akukulu/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { PaymentAccountEntity, PaymentRequestEntity, UserEntity } from '../database/entities';
import { Broadcaster } from '../realtime/broadcaster';
import { GameError, assertPhoneShared, displayName, payeeName } from '../common/util';
import { LedgerService } from './ledger.service';

/** Returns +2517XXXXXXXX / +2519XXXXXXXX, or null when it is not an Ethiopian mobile number. */
export function normalizeEthiopianPhone(input: string): string | null {
  const match = /^(?:\+?251|0)?([79]\d{8})$/.exec(input.replace(/[\s-]/g, ''));
  return match ? `+251${match[1]}` : null;
}

/** Telebirr transaction IDs are letters and digits; compared without regard to case. */
export function normalizeReference(input: string): string | null {
  const value = input.trim().toUpperCase();
  return /^[A-Z0-9]{6,32}$/.test(value) ? value : null;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

function accountSummary(a: PaymentAccountEntity): PaymentAccountSummary {
  return { id: a.id, telegramId: String(a.telegramId), name: a.name, phone: a.phone };
}

/**
 * Manual Telebirr deposits and withdrawals. One account takes payments at a time, and
 * the admin who set it gets each request to check by hand. A deposit is credited only
 * after an admin confirms the money arrived; a withdrawal is held from the balance
 * until an admin sends it or rejects it.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly broadcaster: Broadcaster,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private assertEnabled() {
    if (!this.config.paymentsEnabled) throw new GameError('PAYMENTS_DISABLED', 'Deposits and withdrawals are not available yet', 403);
  }

  private assertAdmin(telegramId: string) {
    if (!this.config.adminTelegramIds.includes(telegramId)) throw new GameError('FORBIDDEN', 'Administrators only', 403);
  }

  private assertAmount(amount: number, min: number, max: number) {
    if (!Number.isInteger(amount) || amount < min || amount > max) {
      throw new GameError('BAD_AMOUNT', `Enter a whole amount between ${min} and ${max} ETB`);
    }
  }

  private assertActive(user: UserEntity | null): asserts user is UserEntity {
    if (!user) throw new GameError('NOT_FOUND', 'User not found', 404);
    if (user.isBanned) throw new GameError('BANNED', 'This account is banned', 403);
    assertPhoneShared(user);
  }

  /* ---- The current Telebirr account ---- */

  async currentAccount(): Promise<PaymentAccountSummary | null> {
    const row = await this.dataSource.getRepository(PaymentAccountEntity).findOneBy({ active: true });
    return row ? accountSummary(row) : null;
  }

  /** Replaces the deposit number. Whoever sets it gets the requests from now on; old rows stay for the record. */
  async setAccount(adminTelegramId: string, input: { phone: string; name: string }): Promise<PaymentAccountSummary> {
    this.assertAdmin(adminTelegramId);
    const phone = normalizeEthiopianPhone(input.phone);
    if (!phone) throw new GameError('BAD_PHONE', 'Enter an Ethiopian mobile number, for example 0912345678');
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new GameError('BAD_NAME', 'Enter the name shown on the Telebirr account');
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PaymentAccountEntity);
      await repo.update({ active: true }, { active: false });
      return accountSummary(await repo.save(repo.create({ telegramId: adminTelegramId, phone, name, active: true })));
    });
  }

  /* ---- Player requests ---- */

  /** The number the player should send this deposit to. */
  async startDeposit(telegramId: string, amount: number): Promise<PaymentAccountSummary> {
    this.assertEnabled();
    this.assertAmount(amount, PAYMENTS.minDeposit, PAYMENTS.maxDeposit);
    this.assertActive(await this.dataSource.getRepository(UserEntity).findOneBy({ telegramId }));
    const account = await this.currentAccount();
    if (!account) throw new GameError('NO_ACCOUNT', 'Deposits are unavailable right now. Please try again later.', 409);
    return account;
  }

  /** `accountId` is the number the player was shown, even if it has changed since. */
  async requestDeposit(telegramId: string, amount: number, reference: string, accountId: string): Promise<PaymentRequestSummary> {
    this.assertEnabled();
    this.assertAmount(amount, PAYMENTS.minDeposit, PAYMENTS.maxDeposit);
    const ref = normalizeReference(reference);
    if (!ref) throw new GameError('BAD_REFERENCE', 'Enter the transaction ID from your Telebirr SMS (letters and numbers only)');
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ telegramId });
    this.assertActive(user);
    const account = await this.dataSource.getRepository(PaymentAccountEntity).findOneBy({ id: accountId });
    if (!account) throw new GameError('NO_ACCOUNT', 'Please start the deposit again');
    const repo = this.dataSource.getRepository(PaymentRequestEntity);
    const pending = await repo.countBy({ userId: user.id, kind: 'deposit', status: 'pending' });
    if (pending >= PAYMENTS.maxPendingDeposits) throw new GameError('TOO_MANY_PENDING', 'Please wait until your earlier deposits are checked');
    let summary: PaymentRequestSummary;
    try {
      const row = await repo.save(repo.create({ userId: user.id, kind: 'deposit', amount, status: 'pending', reference: ref, accountId: account.id }));
      summary = this.summarize(row, user, account);
    } catch (err) {
      if (isUniqueViolation(err)) throw new GameError('DUPLICATE_REFERENCE', 'This transaction ID has already been submitted');
      throw err;
    }
    await this.alertAdmin(summary);
    return summary;
  }

  /** Takes the amount from the balance straight away, so it cannot also be played with. */
  async requestWithdrawal(telegramId: string, amount: number, phone: string): Promise<PaymentRequestSummary> {
    this.assertEnabled();
    this.assertAmount(amount, PAYMENTS.minWithdrawal, PAYMENTS.maxWithdrawal);
    const number = normalizeEthiopianPhone(phone);
    if (!number) throw new GameError('BAD_PHONE', 'Enter an Ethiopian mobile number, for example 0912345678');
    const { summary, userId, balance } = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const user = await users.findOne({ where: { telegramId }, lock: { mode: 'pessimistic_write' } });
      this.assertActive(user);
      if (user.bonusLocked > 0 && amount <= Number(user.balance) && amount > Number(user.balance) - user.bonusLocked) {
        throw new GameError(
          'BONUS_LOCKED',
          `${user.bonusLocked} ETB of your balance is bonus. You can withdraw up to ${Math.max(0, Number(user.balance) - user.bonusLocked)} ETB now, and the rest after wagering ${user.bonusWagerLeft} ETB more.`,
        );
      }
      const account = await manager.getRepository(PaymentAccountEntity).findOneBy({ active: true });
      if (!account) throw new GameError('NO_ACCOUNT', 'Withdrawals are unavailable right now. Please try again later.', 409);
      const repo = manager.getRepository(PaymentRequestEntity);
      if (await repo.countBy({ userId: user.id, kind: 'withdrawal', status: 'pending' })) {
        throw new GameError('TOO_MANY_PENDING', 'You already have a withdrawal waiting to be sent');
      }
      const row = await repo.save(repo.create({ userId: user.id, kind: 'withdrawal', amount, status: 'pending', phone: number, accountId: account.id }));
      const debit = await this.ledger.apply(manager, {
        userId: user.id,
        amount: -amount,
        type: 'withdrawal',
        description: `Withdrawal to ${number}`,
        key: `withdrawal:${row.id}`,
      });
      return { summary: this.summarize(row, { ...user, balance: debit.balance }, account), userId: user.id, balance: debit.balance };
    });
    this.broadcaster.toUser(userId, 'balance:update', { balance });
    await this.alertAdmin(summary);
    return summary;
  }

  /** Tells every admin on Telegram, so no admin moves money unseen by the others. */
  async alertAdmins(text: string) {
    await Promise.all(this.config.adminTelegramIds.map((id) => this.sendTelegram(id, text)));
  }

  /* ---- Sending money to another player ---- */

  /** By the phone number on their Telegram account, or their Telegram username. */
  private async findRecipient(to: string): Promise<UserEntity | null> {
    const users = this.dataSource.getRepository(UserEntity);
    const phone = normalizeEthiopianPhone(to);
    if (phone) return users.findOneBy({ phone });
    const username = to.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(username)) return null;
    return users.createQueryBuilder('u').where('LOWER(u.username) = :username', { username }).getOne();
  }

  /** Bonus money has to be wagered first, so it cannot be sent on. */
  private assertCanSend(sender: UserEntity, amount: number) {
    const free = Math.max(0, Number(sender.balance) - sender.bonusLocked);
    if (amount <= free) return;
    if (sender.bonusLocked > 0 && amount <= Number(sender.balance)) {
      throw new GameError('BONUS_LOCKED', `${sender.bonusLocked} ETB of your balance is bonus. You can send up to ${free} ETB now, and the rest after wagering ${sender.bonusWagerLeft} ETB more.`);
    }
    throw new GameError('INSUFFICIENT_BALANCE', `You only have ${Number(sender.balance)} ETB`);
  }

  private previewOf(recipient: UserEntity, amount: number): TransferPreview {
    const fee = transferFee(amount);
    return { recipientId: recipient.id, recipientName: payeeName(recipient), amount, fee, receives: amount - fee };
  }

  /** Looks the other player up and works out the fee. Nothing moves. */
  async previewTransfer(senderId: string, to: string, amount: number): Promise<TransferPreview> {
    this.assertEnabled();
    this.assertAmount(amount, TRANSFERS.min, TRANSFERS.max);
    const sender = await this.dataSource.getRepository(UserEntity).findOneBy({ id: senderId });
    this.assertActive(sender);
    const recipient = await this.findRecipient(to);
    if (!recipient || recipient.isBanned) throw new GameError('NO_RECIPIENT', 'No Akukulu player was found with that phone number or username', 404);
    if (recipient.id === sender.id) throw new GameError('SELF_TRANSFER', 'You cannot send money to yourself');
    this.assertCanSend(sender, amount);
    return this.previewOf(recipient, amount);
  }

  /**
   * Moves the money in one step: the sender pays the amount, the other player gets it
   * less the fee, and the fee is the house's. `requestId` makes a repeated tap harmless.
   */
  async transfer(senderId: string, recipientId: string, amount: number, requestId: string): Promise<TransferResult> {
    this.assertEnabled();
    this.assertAmount(amount, TRANSFERS.min, TRANSFERS.max);
    if (senderId === recipientId) throw new GameError('SELF_TRANSFER', 'You cannot send money to yourself');
    const key = `transfer:${senderId}:${requestId}`;
    const done = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      // Always locked in the same order, so two players sending to each other cannot deadlock.
      const locked = new Map<string, UserEntity>();
      for (const id of [senderId, recipientId].sort()) {
        const row = await users.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (row) locked.set(id, row);
      }
      const sender = locked.get(senderId) ?? null;
      const recipient = locked.get(recipientId) ?? null;
      this.assertActive(sender);
      if (!recipient || recipient.isBanned) throw new GameError('NO_RECIPIENT', 'That player was not found', 404);
      const preview = this.previewOf(recipient, amount);
      if (await manager.query(`SELECT 1 FROM ledger_entries WHERE "idempotencyKey" = $1`, [`${key}:out`]).then((rows: unknown[]) => rows.length > 0)) {
        return { ...preview, balance: Number(sender.balance), fresh: false, senderName: payeeName(sender), recipientTelegramId: String(recipient.telegramId), recipientBalance: Number(recipient.balance) };
      }
      this.assertCanSend(sender, amount);
      const out = await this.ledger.apply(manager, { userId: sender.id, amount: -amount, type: 'transfer_out', description: `Sent to ${preview.recipientName}`, key: `${key}:out` });
      const received = await this.ledger.apply(manager, {
        userId: recipient.id,
        amount: preview.receives,
        type: 'transfer_in',
        description: `Received from ${payeeName(sender)}`,
        key: `${key}:in`,
      });
      await manager.query(`INSERT INTO house_earnings (id, "gameSlug", amount, "matchId", key, "createdAt") VALUES ($1, 'transfer', $2, NULL, $3, now()) ON CONFLICT (key) DO NOTHING`, [randomUUID(), preview.fee, key]);
      return { ...preview, balance: out.balance, fresh: true, senderName: payeeName(sender), recipientTelegramId: String(recipient.telegramId), recipientBalance: received.balance };
    });
    const { fresh, senderName, recipientTelegramId, recipientBalance, ...result } = done;
    if (fresh) {
      this.broadcaster.toUser(senderId, 'balance:update', { balance: result.balance });
      this.broadcaster.toUser(recipientId, 'balance:update', { balance: recipientBalance });
      await this.sendTelegram(recipientTelegramId, `💸 ${senderName} sent you ${result.receives.toLocaleString()} ETB on Akukulu. Your balance is now ${recipientBalance.toLocaleString()} ETB.`);
    }
    return result;
  }

  /* ---- Checking requests ---- */

  /** Everything waiting, or only what was sent to this admin's number. */
  async listPending(adminTelegramId: string, mineOnly = false, limit = 20): Promise<PaymentRequestSummary[]> {
    this.assertAdmin(adminTelegramId);
    const rows = await this.dataSource.getRepository(PaymentRequestEntity).find({ where: { status: 'pending' }, order: { createdAt: 'ASC' }, take: limit });
    const users = await this.dataSource.getRepository(UserEntity).findBy({ id: In([...new Set(rows.map((r) => r.userId))]) });
    const accounts = await this.dataSource.getRepository(PaymentAccountEntity).findBy({ id: In([...new Set(rows.map((r) => r.accountId).filter((id): id is string => !!id))]) });
    const usersById = new Map(users.map((u) => [u.id, u]));
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const all = rows.map((r) => this.summarize(r, usersById.get(r.userId)!, r.accountId ? accountsById.get(r.accountId) ?? null : null));
    return mineOnly ? all.filter((r) => r.account?.telegramId === adminTelegramId) : all;
  }

  /**
   * Approve means Telebirr was checked: the deposit arrived, or the withdrawal was
   * sent. Rejecting a withdrawal returns the held amount. Admins cannot decide their
   * own request, and each request can be decided once even if tapped twice at once.
   */
  async decide(id: string, adminTelegramId: string, approve: boolean): Promise<PaymentRequestSummary> {
    this.assertAdmin(adminTelegramId);
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PaymentRequestEntity);
      const req = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!req) throw new GameError('NOT_FOUND', 'Payment request not found', 404);
      const users = manager.getRepository(UserEntity);
      const owner = (await users.findOneBy({ id: req.userId }))!;
      if (String(owner.telegramId) === adminTelegramId) throw new GameError('FORBIDDEN', 'Another admin has to decide your own request', 403);
      if (req.status !== 'pending') throw new GameError('ALREADY_DECIDED', `This request was already ${req.status}`);
      const admin = await users.findOneBy({ telegramId: adminTelegramId });
      let balanceChanged = false;
      if (approve && req.kind === 'deposit') {
        await this.releaseSpentBonus(manager, owner);
        await this.ledger.apply(manager, {
          userId: req.userId,
          amount: req.amount,
          type: 'deposit',
          description: `Telebirr deposit ${req.reference}`,
          key: `payment:${req.id}`,
        });
        balanceChanged = true;
      } else if (!approve && req.kind === 'withdrawal') {
        await this.ledger.apply(manager, {
          userId: req.userId,
          amount: req.amount,
          type: 'withdrawal_refund',
          description: 'Withdrawal rejected, amount returned',
          key: `withdrawal-refund:${req.id}`,
        });
        balanceChanged = true;
      }
      Object.assign(req, { status: approve ? 'approved' : 'rejected', decidedBy: admin?.id ?? null, decidedAt: new Date() });
      await repo.save(req);
      const user = (await users.findOneBy({ id: req.userId }))!;
      const account = req.accountId ? await manager.getRepository(PaymentAccountEntity).findOneBy({ id: req.accountId }) : null;
      return { summary: this.summarize(req, user, account), userId: user.id, balance: Number(user.balance), balanceChanged };
    });
    if (result.balanceChanged) this.broadcaster.toUser(result.userId, 'balance:update', { balance: result.balance });
    await this.sendTelegram(result.summary.telegramId, paymentDecisionText(result.summary));
    return result.summary;
  }

  /* ---- Promotions ---- */

  /** The first-deposit bonus has ended. Bonuses already given keep their wagering lock. */
  async firstDepositBonusAvailable(_userId: string): Promise<boolean> {
    return false;
  }

  /** A bonus that was played and lost must not lock the player's next deposit. Money still on a table doesn't count as lost. */
  private async releaseSpentBonus(manager: EntityManager, owner: UserEntity) {
    if (owner.bonusLocked === 0 || Number(owner.balance) > 0) return;
    const [{ playing }] = await manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM match_players mp JOIN matches m ON m.id = mp."matchId"
         WHERE mp."userId" = $1::uuid AND m.status = 'active' AND NOT (
           m.state->'config'->>'permanent' = 'true' AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(m.state->'players') p WHERE p->>'playerId' = $1::text AND p->>'status' = 'active'
           )
         )
       ) AS playing`,
      [owner.id],
    );
    if (!playing) await manager.getRepository(UserEntity).update(owner.id, { bonusLocked: 0, bonusWagerLeft: 0 });
  }

  /* ---- Notifications ---- */

  /** The admin who owns the number gets a pop-up in the app and a Telegram message with buttons. */
  private async alertAdmin(r: PaymentRequestSummary) {
    if (!r.account) return;
    const admin = await this.dataSource.getRepository(UserEntity).findOneBy({ telegramId: r.account.telegramId });
    if (admin) this.broadcaster.toUser(admin.id, 'payment:request', r);
    const { approve, reject } = paymentButtons(r);
    await this.sendTelegram(r.account.telegramId, paymentRequestText(r), { inline_keyboard: [[approve, reject]] });
  }

  /** Never fails the request: the money movement is already committed, and /pending shows anything missed. */
  private async sendTelegram(chatId: string, text: string, replyMarkup?: unknown) {
    if (this.config.nodeEnv === 'test') return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) this.logger.warn(`Telegram refused a message to ${chatId}: ${res.status}. They must press Start in the bot.`);
    } catch (err) {
      this.logger.warn(`Could not message ${chatId} on Telegram: ${(err as Error).message}`);
    }
  }

  private summarize(
    r: PaymentRequestEntity,
    user: Pick<UserEntity, 'telegramId' | 'firstName' | 'lastName' | 'username' | 'balance'>,
    account: PaymentAccountEntity | null,
  ): PaymentRequestSummary {
    return {
      id: r.id,
      kind: r.kind,
      amount: r.amount,
      status: r.status,
      reference: r.reference ?? null,
      phone: r.phone ?? null,
      telegramId: String(user.telegramId),
      displayName: displayName(user),
      username: user.username,
      balance: Number(user.balance),
      account: account ? accountSummary(account) : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
