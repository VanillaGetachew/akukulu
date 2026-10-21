import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { ConfigError, getEngine } from '@akukulu/engines';
import { conquerRequiredBalance, isGameSlug, type GameSlug, type RoomSummary, type RoomVisibility } from '@akukulu/shared';
import { RoomEntity, RoomPlayerEntity, UserEntity } from '../database/entities';
import { GamesService } from '../games/games.service';
import { MatchRuntimeService } from '../matches/match-runtime.service';
import { Broadcaster, roomChannel } from '../realtime/broadcaster';
import { GameError, randomCode } from '../common/util';
import { RoomPresenter } from './room-presenter';

export interface CreateRoomInput {
  gameSlug: string;
  visibility?: RoomVisibility;
  stake?: number;
  maxPlayers?: number;
  config?: Record<string, unknown>;
}

type StartResult = Awaited<ReturnType<MatchRuntimeService['startFromRoom']>>;

/** Default room stake per game: Ludo entry, Poker buy-in, Blackjack minimum bet. */
const DEFAULT_STAKE: Record<GameSlug, number> = { ludo: 0, poker: 500, blackjack: 10, conquer: 0, crazy: 0 };

/** Points a player must hold to sit down. */
function requiredBalance(slug: GameSlug, config: Record<string, unknown>): number {
  if (slug === 'ludo') return Number(config.stake ?? 0);
  if (slug === 'poker') return Number(config.buyIn ?? 0);
  if (slug === 'blackjack') return Number(config.minBet ?? 0);
  // A ጆከር ለመሬት Conquer table needs twice the stake.
  if (slug === 'conquer') return conquerRequiredBalance({ stake: Number(config.stake ?? 0), jokerToGround: config.jokerToGround === true });
  if (slug === 'crazy') return Number(config.stake ?? 0);
  return 0;
}

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly games: GamesService,
    private readonly runtime: MatchRuntimeService,
    private readonly broadcaster: Broadcaster,
    private readonly presenter: RoomPresenter,
  ) {}

  private parse(slug: GameSlug, stake: number, config: Record<string, unknown>) {
    const engine = getEngine(slug)!;
    try {
      const parsed = engine.parseConfig(config, stake) as Record<string, unknown>;
      return { engine, parsed, limits: engine.playerLimits(parsed) };
    } catch (err) {
      if (err instanceof ConfigError) throw new GameError('BAD_CONFIG', err.message);
      throw err;
    }
  }

  private async lockRoom(manager: EntityManager, code: string): Promise<RoomEntity> {
    const room = await manager.getRepository(RoomEntity).findOne({
      where: { code: code.toUpperCase() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'Room not found', 404);
    return room;
  }

  private async assertCanAfford(manager: EntityManager, user: UserEntity, slug: GameSlug, parsed: Record<string, unknown>) {
    const needed = requiredBalance(slug, parsed);
    const fresh = await manager.getRepository(UserEntity).findOneByOrFail({ id: user.id });
    if (fresh.balance < needed) {
      throw new GameError('INSUFFICIENT_BALANCE', `You need ${needed} points to join this table`);
    }
  }

  /** A player sits in at most one waiting room: leaving others keeps counts honest. */
  private async leaveOtherWaitingRooms(manager: EntityManager, userId: string, exceptRoomId?: string): Promise<RoomEntity[]> {
    const seats = await manager
      .getRepository(RoomPlayerEntity)
      .createQueryBuilder('rp')
      .innerJoin(RoomEntity, 'r', 'r.id = rp."roomId"')
      .where('rp."userId" = :userId', { userId })
      .andWhere(`r.status = 'waiting'`)
      .getMany();
    const changed: RoomEntity[] = [];
    for (const seat of seats) {
      if (seat.roomId === exceptRoomId) continue;
      const room = await manager.getRepository(RoomEntity).findOne({ where: { id: seat.roomId }, lock: { mode: 'pessimistic_write' } });
      if (!room || room.status !== 'waiting') continue;
      await this.removeSeat(manager, room, userId);
      changed.push(room);
    }
    return changed;
  }

  private async removeSeat(manager: EntityManager, room: RoomEntity, userId: string) {
    await manager.getRepository(RoomPlayerEntity).delete({ roomId: room.id, userId });
    const remaining = await manager.getRepository(RoomPlayerEntity).find({ where: { roomId: room.id }, order: { seat: 'ASC' } });
    if (remaining.length === 0) room.status = 'cancelled';
    else if (room.hostId === userId) room.hostId = remaining[0].userId;
    await manager.getRepository(RoomEntity).save(room);
  }

  async create(user: UserEntity, input: CreateRoomInput): Promise<RoomSummary> {
    if (!isGameSlug(input.gameSlug)) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    const slug = input.gameSlug;
    const game = await this.games.requirePlayable(slug);
    const stake = Number.isInteger(input.stake) ? (input.stake as number) : DEFAULT_STAKE[slug];
    const { parsed, limits } = this.parse(slug, stake, input.config ?? {});
    const maxPlayers = game.solo ? 1 : Math.min(limits.max, Math.max(limits.min, input.maxPlayers ?? limits.max));
    const visibility: RoomVisibility = game.solo ? 'private' : input.visibility === 'private' ? 'private' : 'public';

    const pending: { start?: StartResult } = {};
    const affected: RoomEntity[] = [];
    const room = await this.dataSource.transaction(async (manager) => {
      await this.assertCanAfford(manager, user, slug, parsed);
      affected.push(...(await this.leaveOtherWaitingRooms(manager, user.id)));
      let code = randomCode();
      for (let i = 0; i < 5 && (await manager.getRepository(RoomEntity).existsBy({ code })); i++) code = randomCode();
      const room = await manager.getRepository(RoomEntity).save(
        manager.getRepository(RoomEntity).create({
          code,
          gameSlug: slug,
          hostId: user.id,
          visibility,
          status: 'waiting',
          minPlayers: limits.min,
          maxPlayers,
          stake,
          config: input.config ?? {},
        }),
      );
      const seat = await manager.getRepository(RoomPlayerEntity).save(
        manager.getRepository(RoomPlayerEntity).create({ id: randomUUID(), roomId: room.id, userId: user.id, seat: 0, ready: game.solo }),
      );
      if (game.solo) pending.start = await this.runtime.startFromRoom(manager, room, [seat]);
      return room;
    });
    if (pending.start) await this.runtime.afterStart(pending.start);
    await this.publishRooms(affected);
    return this.presenter.summary(room);
  }

  async listOpen(slug: GameSlug): Promise<RoomSummary[]> {
    const rooms = await this.dataSource.getRepository(RoomEntity).find({
      where: { gameSlug: slug, status: 'waiting', visibility: 'public' },
      order: { createdAt: 'DESC' },
      take: 30,
    });
    return this.presenter.summaries(rooms);
  }

  async getByCode(code: string): Promise<RoomSummary> {
    const room = await this.dataSource.getRepository(RoomEntity).findOneBy({ code: code.toUpperCase() });
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'Room not found', 404);
    return this.presenter.summary(room);
  }

  async join(user: UserEntity, code: string): Promise<RoomSummary> {
    const affected: RoomEntity[] = [];
    const room = await this.dataSource.transaction(async (manager) => {
      const room = await this.lockRoom(manager, code);
      const seats = await manager.getRepository(RoomPlayerEntity).find({ where: { roomId: room.id } });
      if (seats.some((s) => s.userId === user.id)) return room; // idempotent re-join
      if (room.status !== 'waiting') throw new GameError('ROOM_CLOSED', 'This room is no longer accepting players');
      if (seats.length >= room.maxPlayers) throw new GameError('ROOM_FULL', 'This room is full');
      await this.games.requirePlayable(room.gameSlug);
      const { parsed } = this.parse(room.gameSlug, room.stake, room.config);
      await this.assertCanAfford(manager, user, room.gameSlug, parsed);
      affected.push(...(await this.leaveOtherWaitingRooms(manager, user.id, room.id)));
      const taken = new Set(seats.map((s) => s.seat));
      let seat = 0;
      while (taken.has(seat)) seat++;
      await manager.getRepository(RoomPlayerEntity).insert({ id: randomUUID(), roomId: room.id, userId: user.id, seat, ready: false });
      room.updatedAt = new Date();
      await manager.getRepository(RoomEntity).save(room);
      return room;
    });
    await this.publishRooms([...affected, room]);
    return this.presenter.summary(room);
  }

  async leave(user: UserEntity, code: string): Promise<RoomSummary> {
    const room = await this.dataSource.getRepository(RoomEntity).findOneBy({ code: code.toUpperCase() });
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'Room not found', 404);
    if (room.status === 'in_progress' && room.matchId) {
      await this.runtime.act(room.matchId, user.id, `leave-${randomUUID()}`, { type: 'leave' });
      return this.getByCode(code);
    }
    const updated = await this.dataSource.transaction(async (manager) => {
      const locked = await this.lockRoom(manager, code);
      if (locked.status === 'waiting') await this.removeSeat(manager, locked, user.id);
      return locked;
    });
    await this.publishRooms([updated]);
    return this.presenter.summary(updated);
  }

  async setReady(user: UserEntity, code: string, ready: boolean): Promise<RoomSummary> {
    const pending: { start?: StartResult } = {};
    const room = await this.dataSource.transaction(async (manager) => {
      const room = await this.lockRoom(manager, code);
      if (room.status !== 'waiting') throw new GameError('ROOM_CLOSED', 'This room has already started');
      const seat = await manager.getRepository(RoomPlayerEntity).findOneBy({ roomId: room.id, userId: user.id });
      if (!seat) throw new GameError('NOT_IN_ROOM', 'Join the room first', 403);
      seat.ready = ready;
      await manager.getRepository(RoomPlayerEntity).save(seat);
      const seats = await manager.getRepository(RoomPlayerEntity).find({ where: { roomId: room.id }, order: { seat: 'ASC' } });
      if (seats.length >= room.minPlayers && seats.every((s) => s.ready)) {
        await this.games.requirePlayable(room.gameSlug);
        pending.start = await this.runtime.startFromRoom(manager, room, seats);
      } else {
        room.updatedAt = new Date();
        await manager.getRepository(RoomEntity).save(room);
      }
      return room;
    });
    if (pending.start) await this.runtime.afterStart(pending.start);
    else await this.publishRooms([room]);
    return this.presenter.summary(room);
  }

  /**
   * Joins the fullest open public room with the same stake (and the same ጆከር ለመሬት
   * setting for Conquer), or opens a new one.
   */
  async quickPlay(user: UserEntity, slug: string, stake?: number, config: Record<string, unknown> = {}): Promise<RoomSummary> {
    if (!isGameSlug(slug)) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    const game = await this.games.requirePlayable(slug);
    if (game.solo) return this.create(user, { gameSlug: slug, stake });
    const wanted = Number.isInteger(stake) ? stake! : DEFAULT_STAKE[slug];
    const jokerToGround = slug === 'conquer' && config.jokerToGround === true;
    const candidates: { code: string }[] = await this.dataSource.query(
      `SELECT r.code FROM rooms r
       LEFT JOIN room_players rp ON rp."roomId" = r.id
       WHERE r."gameSlug" = $1 AND r.status = 'waiting' AND r.visibility = 'public' AND r.stake = $2
         AND COALESCE((r.config->>'jokerToGround')::boolean, false) = $4
       GROUP BY r.id
       HAVING COUNT(rp.id) < r."maxPlayers" AND BOOL_AND(rp."userId" IS DISTINCT FROM $3)
       ORDER BY COUNT(rp.id) DESC, r."createdAt" ASC
       LIMIT 5`,
      [slug, wanted, user.id, jokerToGround],
    );
    for (const c of candidates) {
      try {
        return await this.join(user, c.code);
      } catch (err) {
        if (!(err instanceof GameError) || !['ROOM_FULL', 'ROOM_CLOSED'].includes(err.code)) throw err;
      }
    }
    return this.create(user, { gameSlug: slug, stake: wanted, ...(jokerToGround ? { config: { jokerToGround: true } } : {}) });
  }

  async roomsForUser(userId: string): Promise<RoomSummary[]> {
    const seats = await this.dataSource.getRepository(RoomPlayerEntity).findBy({ userId });
    if (!seats.length) return [];
    const rooms = await this.dataSource.getRepository(RoomEntity).find({
      where: { id: In(seats.map((s) => s.roomId)), status: In(['waiting', 'in_progress']) },
    });
    return this.presenter.summaries(rooms);
  }

  private async publishRooms(rooms: RoomEntity[]) {
    for (const room of rooms) {
      try {
        this.broadcaster.emit(roomChannel(room.code), 'room:state', await this.presenter.summary(room));
      } catch (err) {
        this.logger.warn(`Room publish failed: ${(err as Error).message}`);
      }
    }
  }
}
