import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, CurrentUser, JwtAuthGuard } from '../auth/guards';
import type { UserEntity } from '../database/entities';
import { PokerService, type TournamentInput } from '../poker/poker.service';
import { GameError, body, optInt, reqString } from '../common/util';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

@Controller('poker')
@UseGuards(JwtAuthGuard)
export class PokerController {
  constructor(private readonly poker: PokerService) {}

  /** The always-open cash tables, one or more per stake level. */
  @Get('tables')
  tables(@CurrentUser() user: UserEntity) {
    return this.poker.cashTables(user.id);
  }

  @Post('tables/:matchId/sit')
  @HttpCode(200)
  sit(@CurrentUser() user: UserEntity, @Param('matchId') matchId: string, @Body() input: unknown) {
    if (!isUuid(matchId)) throw new GameError('NOT_FOUND', 'Table not found', 404);
    const b = body(input);
    const seat = b.seat === undefined ? undefined : optInt(b.seat, 'seat', 0, 8, 0);
    return this.poker.sit(user.id, matchId, optInt(b.buyIn, 'buyIn', 1, 100_000_000, 0), seat);
  }

  /** The caller's recent hands (optionally at one table), with hidden cards removed. */
  @Get('hands')
  hands(@CurrentUser() user: UserEntity, @Query('matchId') matchId?: string, @Query('limit') limit?: string) {
    if (matchId && !isUuid(matchId)) throw new GameError('NOT_FOUND', 'Table not found', 404);
    return this.poker.handHistory(user.id, matchId ?? null, optInt(limit, 'limit', 1, 100, 30));
  }

  @Get('tournaments')
  tournaments(@CurrentUser() user: UserEntity) {
    return this.poker.listTournaments(user.id);
  }

  @Get('tournaments/:id')
  tournament(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.poker.tournament(id, user.id);
  }

  @Post('tournaments/:id/register')
  @HttpCode(200)
  register(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    if (!isUuid(id)) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
    return this.poker.register(user.id, id);
  }

  @Post('tournaments/:id/unregister')
  @HttpCode(200)
  unregister(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    if (!isUuid(id)) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
    return this.poker.unregister(user.id, id);
  }
}

/** Reads a tournament form; with `partial`, missing fields are left out (for edits). */
function tournamentInput(input: unknown, partial: boolean): Partial<TournamentInput> {
  const b = body(input);
  const out: Partial<TournamentInput> = {};
  const has = (k: string) => b[k] !== undefined && b[k] !== null && b[k] !== '';
  if (!partial || has('name')) out.name = reqString(b.name, 'name', 60);
  if (!partial || has('startsAt')) {
    const at = new Date(typeof b.startsAt === 'string' || typeof b.startsAt === 'number' ? b.startsAt : NaN);
    if (Number.isNaN(at.getTime())) throw new GameError('BAD_START', 'startsAt must be a date and time');
    out.startsAt = at;
  }
  const int = (k: keyof TournamentInput, min: number, max: number, fallback: number) => {
    if (!partial || has(k)) (out as Record<string, unknown>)[k] = optInt(b[k], k, min, max, fallback);
  };
  int('buyIn', 0, 1_000_000, 0);
  int('guarantee', 0, 100_000_000, 0);
  int('startingStack', 500, 1_000_000, 3000);
  int('levelMinutes', 1, 60, 8);
  int('lateRegLevels', 0, 12, 3);
  int('maxEntrants', 2, 1000, 90);
  int('tableSize', 2, 9, 9);
  return out;
}

@Controller('admin/tournaments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTournamentsController {
  constructor(private readonly poker: PokerService) {}

  @Get()
  list() {
    return this.poker.listTournaments(null, true);
  }

  @Post()
  create(@CurrentUser() user: UserEntity, @Body() input: unknown) {
    return this.poker.create(tournamentInput(input, false) as TournamentInput, user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: unknown) {
    if (!isUuid(id)) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
    return this.poker.update(id, tournamentInput(input, true));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() input: unknown) {
    if (!isUuid(id)) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
    const reason = typeof body(input).reason === 'string' ? String(body(input).reason).slice(0, 120) : 'cancelled by an administrator';
    return this.poker.cancel(id, reason);
  }
}
