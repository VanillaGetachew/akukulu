import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isGameSlug, type LeaderboardRow, type PlayerStatsSummary } from '@akukulu/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, JwtAuthGuard } from '../auth/guards';
import { MatchEntity, MatchEventEntity, MatchPlayerEntity, PlayerStatsEntity, UserEntity } from '../database/entities';
import { GamesService } from '../games/games.service';
import { MatchRuntimeService } from '../matches/match-runtime.service';
import { RoomsService } from '../rooms/rooms.service';
import { WalletService } from '../wallet/wallet.service';
import { PresenceService } from '../realtime/presence.service';
import { PokerService } from '../poker/poker.service';
import { GameError, body, displayName, optInt, reqString, toProfile } from '../common/util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('config')
  authConfig() {
    return { devAuth: this.config.allowDevAuth, botUsername: this.config.botUsername };
  }

  @Post('telegram')
  @HttpCode(200)
  telegram(@Body() input: unknown) {
    return this.auth.loginWithInitData(reqString(body(input).initData, 'initData', 8192));
  }

  @Post('dev')
  @HttpCode(200)
  dev(@Body() input: unknown) {
    const name = reqString(body(input).name, 'name', 24);
    if (!/^[\p{L}\p{N} _-]{2,24}$/u.test(name)) throw new GameError('BAD_NAME', 'Use 2–24 letters or digits');
    return this.auth.devLogin(name);
  }
}

@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly presence: PresenceService,
  ) {}

  @Get('health')
  async health() {
    await this.dataSource.query('SELECT 1');
    return { ok: true, online: await this.presence.onlineCount(), time: Date.now() };
  }
}

@Controller('games')
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly rooms: RoomsService,
  ) {}

  @Get()
  list() {
    return this.games.list();
  }

  @Get(':slug/rooms')
  @UseGuards(JwtAuthGuard)
  openRooms(@Param('slug') slug: string) {
    if (!isGameSlug(slug)) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    return this.rooms.listOpen(slug);
  }
}

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  create(@CurrentUser() user: UserEntity, @Body() input: unknown) {
    const b = body(input);
    return this.rooms.create(user, {
      gameSlug: reqString(b.gameSlug, 'gameSlug'),
      visibility: b.visibility === 'private' ? 'private' : 'public',
      stake: b.stake === undefined ? undefined : optInt(b.stake, 'stake', 0, 1_000_000, 0),
      maxPlayers: b.maxPlayers === undefined ? undefined : optInt(b.maxPlayers, 'maxPlayers', 1, 9, 2),
      config: body(b.config),
    });
  }

  @Post('quick-play')
  @HttpCode(200)
  quickPlay(@CurrentUser() user: UserEntity, @Body() input: unknown) {
    const b = body(input);
    return this.rooms.quickPlay(user, reqString(b.gameSlug, 'gameSlug'), b.stake === undefined ? undefined : optInt(b.stake, 'stake', 0, 1_000_000, 0), body(b.config));
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.rooms.getByCode(code);
  }

  @Post(':code/join')
  @HttpCode(200)
  join(@CurrentUser() user: UserEntity, @Param('code') code: string) {
    return this.rooms.join(user, code);
  }

  @Post(':code/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: UserEntity, @Param('code') code: string) {
    return this.rooms.leave(user, code);
  }

  @Post(':code/ready')
  @HttpCode(200)
  ready(@CurrentUser() user: UserEntity, @Param('code') code: string, @Body() input: unknown) {
    return this.rooms.setReady(user, code, body(input).ready !== false);
  }
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly wallet: WalletService,
    private readonly runtime: MatchRuntimeService,
    private readonly rooms: RoomsService,
  ) {}

  @Get()
  me(@CurrentUser() user: UserEntity) {
    return toProfile(user);
  }

  @Get('stats')
  async stats(@CurrentUser() user: UserEntity): Promise<PlayerStatsSummary[]> {
    const rows = await this.dataSource.getRepository(PlayerStatsEntity).findBy({ userId: user.id });
    return rows.map(({ gameSlug, played, won, lost, drawn, pointsWon }) => ({ gameSlug, played, won, lost, drawn, pointsWon }));
  }

  @Get('transactions')
  transactions(@CurrentUser() user: UserEntity, @Query('limit') limit?: string) {
    return this.wallet.transactions(user.id, optInt(limit, 'limit', 1, 100, 30));
  }

  @Get('matches')
  async matches(@CurrentUser() user: UserEntity, @Query('limit') limit?: string) {
    const take = optInt(limit, 'limit', 1, 50, 20);
    const mine = await this.dataSource.getRepository(MatchPlayerEntity).find({ where: { userId: user.id } });
    if (!mine.length) return [];
    const matches = await this.dataSource
      .getRepository(MatchEntity)
      .createQueryBuilder('m')
      .where('m.id IN (:...ids)', { ids: mine.map((m) => m.matchId) })
      .orderBy('m."startedAt"', 'DESC')
      .take(take)
      .getMany();
    return Promise.all(matches.map((m) => this.runtime.summaryOf(m)));
  }

  /** Everything a reconnecting client needs to resume: open rooms and active matches. */
  @Get('active')
  async active(@CurrentUser() user: UserEntity) {
    const [rooms, matches] = await Promise.all([this.rooms.roomsForUser(user.id), this.runtime.findActiveForUser(user.id)]);
    return { rooms, matches: matches.map((m) => ({ id: m.id, gameSlug: m.gameSlug, roomId: m.roomId })) };
  }
}

@Controller('rewards')
@UseGuards(JwtAuthGuard)
export class RewardsController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  status(@CurrentUser() user: UserEntity) {
    return this.wallet.rewardsStatus(user.id);
  }

  @Post('daily')
  @HttpCode(200)
  daily(@CurrentUser() user: UserEntity) {
    return this.wallet.claimDaily(user.id);
  }
}

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(
    private readonly runtime: MatchRuntimeService,
    private readonly dataSource: DataSource,
  ) {}

  private async load(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GameError('NOT_FOUND', 'Match not found', 404);
    const match = await this.runtime.getMatch(id);
    if (!match) throw new GameError('NOT_FOUND', 'Match not found', 404);
    return match;
  }

  @Get(':id')
  async summary(@Param('id') id: string) {
    return this.runtime.summaryOf(await this.load(id));
  }

  /** The caller's personalised view (players see their own cards only). */
  @Get(':id/state')
  async state(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    const match = await this.load(id);
    const isPlayer = await this.runtime.isPlayer(id, user.id);
    return this.runtime.payloadFor(match, isPlayer ? user.id : null);
  }

  /** Event log for replay — participants only, and only once the match is over. */
  @Get(':id/events')
  async events(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    const match = await this.load(id);
    if (!(await this.runtime.isPlayer(id, user.id)) && !user.isAdmin) throw new GameError('FORBIDDEN', 'Participants only', 403);
    if (match.status === 'active' && !user.isAdmin) throw new GameError('MATCH_ACTIVE', 'Replays are available after the match');
    const events = await this.dataSource.getRepository(MatchEventEntity).find({ where: { matchId: id }, order: { seq: 'ASC' } });
    // Hand histories keep every hole card; players only get back their own and the ones shown down.
    return PokerService.redactEvents(events, user.isAdmin ? null : user.id).map((e) => ({
      seq: e.seq,
      type: e.type,
      userId: e.userId,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    }));
  }
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async leaderboard(@Query('game') game?: string, @Query('limit') limit?: string): Promise<LeaderboardRow[]> {
    const take = optInt(limit, 'limit', 1, 100, 50);
    const filterGame = game && game !== 'all' ? game : null;
    if (filterGame && !isGameSlug(filterGame)) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    const rows: (UserEntity & { played: string; won: string; pointsWon: string })[] = await this.dataSource.query(
      `SELECT u.id, u."firstName", u."lastName", u.username, u."photoUrl",
              SUM(s.played) AS played, SUM(s.won) AS won, SUM(s."pointsWon") AS "pointsWon"
       FROM player_stats s JOIN users u ON u.id = s."userId"
       WHERE u."isBanned" = false AND ($1::varchar IS NULL OR s."gameSlug" = $1)
       GROUP BY u.id
       ORDER BY SUM(s.won) DESC, SUM(s."pointsWon") DESC, SUM(s.played) ASC
       LIMIT $2`,
      [filterGame, take],
    );
    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.id,
      displayName: displayName(r),
      photoUrl: r.photoUrl,
      played: Number(r.played),
      won: Number(r.won),
      pointsWon: Number(r.pointsWon),
    }));
  }
}
