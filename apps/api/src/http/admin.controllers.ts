import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, ILike } from 'typeorm';
import { isGameSlug, type AdminRevenue, type MatchStatus } from '@akukulu/shared';
import { AdminGuard, CurrentUser, InternalKeyGuard, JwtAuthGuard } from '../auth/guards';
import { MatchEntity, UserEntity } from '../database/entities';
import { GamesService } from '../games/games.service';
import { MatchRuntimeService } from '../matches/match-runtime.service';
import { PresenceService } from '../realtime/presence.service';
import { UsersService } from '../users/users.service';
import { LedgerService } from '../wallet/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { RewardsService } from '../wallet/rewards.service';
import { PaymentsService } from '../wallet/payments.service';
import { GameError, body, optInt, reqString, toProfile } from '../common/util';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly games: GamesService,
    private readonly runtime: MatchRuntimeService,
    private readonly ledger: LedgerService,
    private readonly presence: PresenceService,
    private readonly rewards: RewardsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('overview')
  async overview() {
    const [[users], [points], activeMatches, [rooms], online] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int AS count FROM users`),
      this.dataSource.query(`SELECT COALESCE(SUM(balance),0)::bigint AS total FROM users`),
      this.runtime.countActive(),
      this.dataSource.query(`SELECT COUNT(*)::int AS count FROM rooms WHERE status = 'waiting'`),
      this.presence.onlineCount(),
    ]);
    const perGame = await this.dataSource.query(
      `SELECT "gameSlug", status, COUNT(*)::int AS count FROM matches GROUP BY "gameSlug", status ORDER BY "gameSlug"`,
    );
    const [{ count: pendingRewards }] = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM reward_requests WHERE status = 'pending'`);
    const [{ total: houseEarnings }] = await this.dataSource.query(`SELECT COALESCE(SUM(amount),0)::bigint AS total FROM house_earnings`);
    return { users: users.count, pointsInCirculation: Number(points.total), houseEarnings: Number(houseEarnings), activeMatches, waitingRooms: rooms.count, online, pendingRewards, perGame };
  }

  @Get('games')
  listGames() {
    return this.games.list();
  }

  @Patch('games/:slug')
  updateGame(@Param('slug') slug: string, @Body() input: unknown) {
    if (!isGameSlug(slug)) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    const b = body(input);
    return this.games.update(slug, {
      ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
      ...(typeof b.maintenance === 'boolean' ? { maintenance: b.maintenance } : {}),
      ...(typeof b.maintenanceMessage === 'string' || b.maintenanceMessage === null ? { maintenanceMessage: b.maintenanceMessage as string | null } : {}),
    });
  }

  @Get('users')
  async users(@Query('q') q?: string) {
    const repo = this.dataSource.getRepository(UserEntity);
    const where = q ? [{ username: ILike(`%${q}%`) }, { firstName: ILike(`%${q}%`) }, ...(/^\d+$/.test(q) ? [{ telegramId: q }] : [])] : {};
    const rows = await repo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
    return rows.map((u) => ({ ...toProfile(u), phone: u.phone, isBanned: u.isBanned, lastSeenAt: u.lastSeenAt }));
  }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() input: unknown) {
    const b = body(input);
    const repo = this.dataSource.getRepository(UserEntity);
    const user = await repo.findOneBy({ id });
    if (!user) throw new GameError('NOT_FOUND', 'User not found', 404);
    if (typeof b.isBanned === 'boolean') user.isBanned = b.isBanned;
    await repo.save(user);
    return { ...toProfile(user), isBanned: user.isBanned };
  }

  /** Manual correction of virtual points; always recorded in the ledger. */
  @Post('users/:id/adjust')
  @HttpCode(200)
  async adjust(@CurrentUser() admin: UserEntity, @Param('id') id: string, @Body() input: unknown) {
    const b = body(input);
    const amount = optInt(b.amount, 'amount', -1_000_000, 1_000_000, 0);
    if (amount === 0) throw new GameError('BAD_AMOUNT', 'Amount must not be zero');
    const reason = reqString(b.reason, 'reason', 200);
    const key = typeof b.idempotencyKey === 'string' && b.idempotencyKey ? `admin:${b.idempotencyKey}` : `admin:${randomUUID()}`;
    return this.ledger.applyStandalone({ userId: id, amount, type: 'admin_adjustment', description: `${reason} (by ${admin.id})`, key });
  }

  /* ---- Rewards: only administrators can authorise them ---- */

  @Get('rewards')
  rewardRequests(@Query('status') status?: string) {
    const s = status === 'approved' || status === 'rejected' || status === 'all' ? status : 'pending';
    return this.rewards.list(s);
  }

  @Post('rewards/:id/approve')
  @HttpCode(200)
  approveReward(@CurrentUser() admin: UserEntity, @Param('id') id: string) {
    return this.rewards.approve(id, admin.id);
  }

  @Post('rewards/:id/reject')
  @HttpCode(200)
  async rejectReward(@CurrentUser() admin: UserEntity, @Param('id') id: string, @Body() input: unknown) {
    const note = body(input).note;
    await this.rewards.reject(id, admin.id, typeof note === 'string' ? note.slice(0, 200) : null);
    return { ok: true };
  }

  /** Manually deposit coins into an account (positive amounts only; recorded in the ledger). */
  @Post('users/:id/deposit')
  @HttpCode(200)
  deposit(@CurrentUser() admin: UserEntity, @Param('id') id: string, @Body() input: unknown) {
    const b = body(input);
    const amount = optInt(b.amount, 'amount', 1, 10_000_000, 0);
    const reason = reqString(b.reason, 'reason', 200);
    return this.rewards.deposit(id, amount, reason, admin.id, typeof b.idempotencyKey === 'string' ? b.idempotencyKey : undefined);
  }

  /** Everything the house earned from cuts, what promotions cost, and the money moved. Days are Ethiopian days. */
  @Get('revenue')
  async revenue(): Promise<AdminRevenue> {
    const day = `("createdAt" AT TIME ZONE 'Africa/Addis_Ababa')::date`;
    const today = `(now() AT TIME ZONE 'Africa/Addis_Ababa')::date`;
    const num = (rows: { total: string | null }[]) => Number(rows[0]?.total ?? 0);
    const [totals] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total,
              COALESCE(SUM(amount) FILTER (WHERE ${day} = ${today}), 0)::bigint AS today,
              COALESCE(SUM(amount) FILTER (WHERE ${day} > ${today} - 7), 0)::bigint AS week,
              COALESCE(SUM(amount) FILTER (WHERE ${day} > ${today} - 30), 0)::bigint AS month
       FROM house_earnings`,
    );
    const byGame: { gameSlug: string; total: string }[] = await this.dataSource.query(`SELECT "gameSlug", SUM(amount)::bigint AS total FROM house_earnings GROUP BY "gameSlug" ORDER BY total DESC`);
    const bySource: { source: string; total: string }[] = await this.dataSource.query(
      `SELECT CASE WHEN key LIKE '%:hand:%' THEN 'Poker cash game pots'
                   WHEN key LIKE '%:prize-pool' THEN 'Poker tournament prize pools'
                   ELSE 'Ludo, Conquer and Crazy prizes' END AS source,
              SUM(amount)::bigint AS total
       FROM house_earnings GROUP BY 1 ORDER BY total DESC`,
    );
    const daily: { day: string; total: string }[] = await this.dataSource.query(
      `SELECT to_char(${day}, 'YYYY-MM-DD') AS day, SUM(amount)::bigint AS total
       FROM house_earnings WHERE ${day} > ${today} - 14 GROUP BY 1 ORDER BY 1 DESC`,
    );
    const paid = (type: string) => this.dataSource.query(`SELECT SUM(amount)::bigint AS total FROM ledger_entries WHERE type = $1`, [type]);
    const moved = (kind: string) => this.dataSource.query(`SELECT SUM(amount)::bigint AS total FROM payment_requests WHERE kind = $1 AND status = 'approved'`, [kind]);
    const [bonuses, referrals, deposits, withdrawals, balances] = await Promise.all([
      paid('deposit_bonus'),
      paid('referral'),
      moved('deposit'),
      moved('withdrawal'),
      this.dataSource.query(`SELECT SUM(balance)::bigint AS total FROM users`),
    ]);
    const total = Number(totals.total);
    return {
      today: Number(totals.today),
      last7Days: Number(totals.week),
      last30Days: Number(totals.month),
      total,
      byGame: byGame.map((g) => ({ gameSlug: g.gameSlug, total: Number(g.total) })),
      bySource: bySource.map((s) => ({ source: s.source, total: Number(s.total) })),
      daily: daily.map((d) => ({ day: d.day, total: Number(d.total) })),
      bonusesPaid: num(bonuses),
      referralsPaid: num(referrals),
      net: total - num(bonuses) - num(referrals),
      deposits: num(deposits),
      withdrawals: num(withdrawals),
      playerBalances: num(balances),
    };
  }

  /* ---- Manual Telebirr payments, from the web app ---- */

  @Get('payments')
  paymentRequests(@CurrentUser() admin: UserEntity, @Query('mine') mine?: string) {
    return this.payments.listPending(String(admin.telegramId), mine === '1');
  }

  @Get('payments/account')
  async paymentAccount() {
    return { account: await this.payments.currentAccount() };
  }

  @Post('payments/account')
  @HttpCode(200)
  setPaymentAccount(@CurrentUser() admin: UserEntity, @Body() input: unknown) {
    const b = body(input);
    return this.payments.setAccount(String(admin.telegramId), { phone: reqString(b.phone, 'phone', 32), name: reqString(b.name, 'name', 80) });
  }

  @Post('payments/:id/:decision')
  @HttpCode(200)
  decidePayment(@CurrentUser() admin: UserEntity, @Param('id') id: string, @Param('decision') decision: string) {
    if (decision !== 'approve' && decision !== 'reject') throw new GameError('BAD_DECISION', 'Unknown decision');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new GameError('NOT_FOUND', 'Payment request not found', 404);
    return this.payments.decide(id, String(admin.telegramId), decision === 'approve');
  }

  @Get('matches')
  async matches(@Query('status') status?: string) {
    const where = status === 'active' || status === 'finished' || status === 'cancelled' ? { status: status as MatchStatus } : {};
    const rows = await this.dataSource.getRepository(MatchEntity).find({
      where,
      order: { startedAt: 'DESC' },
      take: 50,
      select: ['id', 'gameSlug', 'status', 'roomId', 'version', 'startedAt', 'endedAt'],
    });
    return Promise.all(rows.map((m) => this.runtime.summaryOf(m)));
  }

  @Post('matches/:id/void')
  @HttpCode(200)
  async voidMatch(@Param('id') id: string, @Body() input: unknown) {
    await this.runtime.voidMatch(id, reqString(body(input).reason, 'reason', 200));
    return { ok: true };
  }
}

/** Endpoints for the Telegram bot process, protected by INTERNAL_API_KEY. */
@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalController {
  constructor(
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('users')
  @HttpCode(200)
  async upsert(@Body() input: unknown) {
    const b = body(input);
    const from = body(b.from);
    if (typeof from.id !== 'number' || typeof from.first_name !== 'string') throw new GameError('BAD_USER', 'Telegram user required');
    const user = await this.users.upsertFromTelegram(
      {
        id: from.id,
        first_name: from.first_name,
        last_name: typeof from.last_name === 'string' ? from.last_name : undefined,
        username: typeof from.username === 'string' ? from.username : undefined,
        language_code: typeof from.language_code === 'string' ? from.language_code : undefined,
      },
      typeof b.startParam === 'string' ? b.startParam : null,
    );
    return this.summary(user);
  }

  @Get('users/:telegramId')
  async get(@Param('telegramId') telegramId: string) {
    if (!/^\d{1,20}$/.test(telegramId)) throw new GameError('BAD_ID', 'Invalid Telegram id');
    const user = await this.users.findByTelegramId(telegramId);
    if (!user) throw new GameError('NOT_FOUND', 'User not found', 404);
    return this.summary(user);
  }

  @Post('users/:telegramId/daily')
  @HttpCode(200)
  async daily(@Param('telegramId') telegramId: string) {
    const user = await this.users.findByTelegramId(telegramId);
    if (!user) throw new GameError('NOT_FOUND', 'User not found', 404);
    return this.wallet.claimDaily(user.id);
  }

  /* ---- Manual Telebirr payments, driven from the bot ---- */

  @Post('users/:telegramId/payments/deposit/start')
  @HttpCode(200)
  startDeposit(@Param('telegramId') telegramId: string, @Body() input: unknown) {
    return this.payments.startDeposit(telegramId, Number(body(input).amount));
  }

  @Post('users/:telegramId/payments/deposit')
  @HttpCode(200)
  deposit(@Param('telegramId') telegramId: string, @Body() input: unknown) {
    const b = body(input);
    return this.payments.requestDeposit(telegramId, Number(b.amount), reqString(b.reference, 'reference', 64), reqString(b.accountId, 'accountId', 36));
  }

  @Post('users/:telegramId/payments/withdraw')
  @HttpCode(200)
  withdraw(@Param('telegramId') telegramId: string, @Body() input: unknown) {
    const b = body(input);
    return this.payments.requestWithdrawal(telegramId, Number(b.amount), reqString(b.phone, 'phone', 32));
  }

  /** The bot passes on a number only when Telegram says it belongs to the sender. */
  @Post('users/:telegramId/phone')
  @HttpCode(200)
  async savePhone(@Param('telegramId') telegramId: string, @Body() input: unknown) {
    return this.summary(await this.users.savePhone(telegramId, reqString(body(input).phone, 'phone', 32)));
  }

  @Get('payments/pending/:adminTelegramId')
  pendingPayments(@Param('adminTelegramId') adminTelegramId: string) {
    return this.payments.listPending(adminTelegramId);
  }

  @Get('payments/account')
  async paymentAccount() {
    return { account: await this.payments.currentAccount() };
  }

  @Post('payments/account')
  @HttpCode(200)
  setPaymentAccount(@Body() input: unknown) {
    const b = body(input);
    return this.payments.setAccount(reqString(b.adminTelegramId, 'adminTelegramId', 20), { phone: reqString(b.phone, 'phone', 32), name: reqString(b.name, 'name', 80) });
  }

  @Post('payments/:id/:decision')
  @HttpCode(200)
  decidePayment(@Param('id') id: string, @Param('decision') decision: string, @Body() input: unknown) {
    if (decision !== 'approve' && decision !== 'reject') throw new GameError('BAD_DECISION', 'Unknown decision');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new GameError('NOT_FOUND', 'Payment request not found', 404);
    return this.payments.decide(id, reqString(body(input).adminTelegramId, 'adminTelegramId', 20), decision === 'approve');
  }

  private async summary(user: UserEntity) {
    const [rewards, transactions, firstDepositBonus] = await Promise.all([
      this.wallet.rewardsStatus(user.id),
      this.wallet.transactions(user.id, 5),
      this.payments.firstDepositBonusAvailable(user.id),
    ]);
    return { profile: toProfile(user), rewards, transactions, firstDepositBonus };
  }
}
