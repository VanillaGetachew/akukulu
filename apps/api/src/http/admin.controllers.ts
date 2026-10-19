import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, ILike } from 'typeorm';
import { isGameSlug, type MatchStatus } from '@akukulu/shared';
import { AdminGuard, CurrentUser, InternalKeyGuard, JwtAuthGuard } from '../auth/guards';
import { MatchEntity, UserEntity } from '../database/entities';
import { GamesService } from '../games/games.service';
import { MatchRuntimeService } from '../matches/match-runtime.service';
import { PresenceService } from '../realtime/presence.service';
import { UsersService } from '../users/users.service';
import { LedgerService } from '../wallet/ledger.service';
import { WalletService } from '../wallet/wallet.service';
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
    return { users: users.count, pointsInCirculation: Number(points.total), activeMatches, waitingRooms: rooms.count, online, perGame };
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
    return rows.map((u) => ({ ...toProfile(u), isBanned: u.isBanned, lastSeenAt: u.lastSeenAt }));
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

  private async summary(user: UserEntity) {
    const [rewards, transactions] = await Promise.all([this.wallet.rewardsStatus(user.id), this.wallet.transactions(user.id, 5)]);
    return { profile: toProfile(user), rewards, transactions };
  }
}
