import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { cryptoRng, getEngine, type EngineContext, type EngineResult, type GameEngine, type Rng } from '@akukulu/engines';
import type { MatchStatePayload, MatchSummary } from '@akukulu/shared';
import {
  MatchEntity,
  MatchEventEntity,
  MatchPlayerEntity,
  RoomEntity,
  RoomPlayerEntity,
  UserEntity,
} from '../database/entities';
import { LedgerService } from '../wallet/ledger.service';
import { Broadcaster, roomChannel, spectatorChannel } from '../realtime/broadcaster';
import { RoomPresenter } from '../rooms/room-presenter';
import { PresenceService } from '../realtime/presence.service';
import { GameError, displayName } from '../common/util';

type Input =
  | { kind: 'action'; userId: string; clientActionId: string; action: Record<string, unknown> }
  | { kind: 'tick' }
  /** Taking a seat in a running match (cash tables, late tournament registration). */
  | { kind: 'join'; userId: string; action: Record<string, unknown> };

interface Committed {
  match: MatchEntity;
  players: MatchPlayerEntity[];
  touchedUsers: Set<string>;
  finished: boolean;
  /** Players who just took a seat: they stop receiving the spectator view. */
  joined?: string[];
  /** Players who just stood up from an open table: they keep watching as spectators. */
  dropped?: string[];
}

const SWEEP_INTERVAL_MS = 5_000;
const MAX_TIMER_MS = 2_147_000_000;

function engineFor(slug: MatchEntity['gameSlug']): GameEngine {
  const engine = getEngine(slug);
  if (!engine) throw new GameError('GAME_UNAVAILABLE', 'This game is not available yet');
  return engine;
}

/**
 * Server-authoritative match runtime. Every state transition — player action
 * or timer tick — runs in one PostgreSQL transaction holding a row lock on the
 * match: engine transition, ledger movements, event log, result and statistics
 * are committed together or not at all. Clients only ever receive personalised views.
 */
@Injectable()
export class MatchRuntimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MatchRuntimeService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private sweepHandle: NodeJS.Timeout | null = null;
  /** Overridable for deterministic tests. */
  rng: Rng = cryptoRng;
  now: () => number = () => Date.now();

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly broadcaster: Broadcaster,
    private readonly rooms: RoomPresenter,
    private readonly presence: PresenceService,
  ) {}

  /* ---------------- lifecycle & recovery ---------------- */

  async onApplicationBootstrap() {
    await this.recover();
    if (process.env.DISABLE_MATCH_SWEEP !== 'true') {
      this.sweepHandle = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    }
  }

  onModuleDestroy() {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Re-arms timers for every active match persisted in PostgreSQL (e.g. after a restart). */
  async recover(): Promise<number> {
    const active = await this.dataSource.getRepository(MatchEntity).find({ where: { status: 'active' }, select: ['id', 'deadline'] });
    for (const m of active) this.schedule(m.id, m.deadline);
    if (active.length) this.logger.log(`Recovered ${active.length} active match(es)`);
    return active.length;
  }

  async sweep() {
    try {
      const due: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM matches WHERE status = 'active' AND deadline IS NOT NULL AND deadline <= $1 LIMIT 200`,
        [this.now()],
      );
      for (const { id } of due) void this.tick(id);
      await this.dataSource.query(
        `UPDATE rooms SET status = 'cancelled', "updatedAt" = now()
         WHERE status = 'waiting' AND "updatedAt" < now() - interval '2 hours'`,
      );
    } catch (err) {
      this.logger.warn(`Sweep failed: ${(err as Error).message}`);
    }
  }

  private schedule(matchId: string, deadline: number | null) {
    const existing = this.timers.get(matchId);
    if (existing) clearTimeout(existing);
    this.timers.delete(matchId);
    if (deadline === null) return;
    const delay = Math.min(Math.max(0, deadline - this.now()) + 25, MAX_TIMER_MS);
    const handle = setTimeout(() => {
      this.timers.delete(matchId);
      void this.tick(matchId);
    }, delay);
    handle.unref?.();
    this.timers.set(matchId, handle);
  }

  /** Serialises work per match inside this process (the DB row lock covers other instances). */
  private serialize<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(matchId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.queues.set(matchId, tail);
    void tail.then(() => {
      if (this.queues.get(matchId) === tail) this.queues.delete(matchId);
    });
    return run;
  }

  private ctx(balances: Record<string, number>): EngineContext {
    return { rng: this.rng, now: this.now(), balances };
  }

  /* ---------------- starting ---------------- */

  /** Creates the match for a room. Must be called inside the room's transaction. */
  async startFromRoom(manager: EntityManager, room: RoomEntity, seats: RoomPlayerEntity[]): Promise<Committed> {
    const engine = engineFor(room.gameSlug);
    let config: unknown;
    try {
      config = engine.parseConfig(room.config, room.stake);
    } catch (err) {
      throw new GameError('BAD_CONFIG', (err as Error).message);
    }
    const userIds = seats.map((s) => s.userId);
    const balances = await this.ledger.balancesFor(manager, userIds);
    const res = engine.start(seats.map((s) => ({ playerId: s.userId, seat: s.seat })), config, this.ctx(balances));
    if (!res.ok) throw new GameError(res.code, res.error);

    const match = await manager.getRepository(MatchEntity).save(
      manager.getRepository(MatchEntity).create({
        roomId: room.id,
        gameSlug: room.gameSlug,
        status: 'active',
        state: res.state,
        version: 1,
        deadline: engine.deadline(res.state),
      }),
    );
    const players = await manager.getRepository(MatchPlayerEntity).save(
      seats.map((s) => manager.getRepository(MatchPlayerEntity).create({ matchId: match.id, userId: s.userId, seat: s.seat })),
    );
    const touchedUsers = new Set<string>();
    await this.applyLedger(manager, match.id, res, touchedUsers);
    await this.appendEvents(manager, match.id, null, null, res);
    let finished = false;
    if (engine.isFinished(res.state)) {
      await this.finalize(manager, match, engine, players);
      finished = true;
    }
    room.status = finished ? 'finished' : 'in_progress';
    room.matchId = match.id;
    await manager.getRepository(RoomEntity).save(room);
    return { match, players, touchedUsers, finished };
  }

  /**
   * Opens a match that has no room: a permanent cash table (no players yet) or a
   * scheduled tournament (its registered players). Publishes it straight away.
   */
  async startStandalone(gameSlug: MatchEntity['gameSlug'], configInput: unknown, stake: number, userIds: string[]): Promise<MatchEntity> {
    const engine = engineFor(gameSlug);
    let config: unknown;
    try {
      config = engine.parseConfig(configInput, stake);
    } catch (err) {
      throw new GameError('BAD_CONFIG', (err as Error).message);
    }
    const committed = await this.dataSource.transaction(async (manager) => {
      const balances = await this.ledger.balancesFor(manager, userIds);
      const res = engine.start(userIds.map((id, seat) => ({ playerId: id, seat })), config, this.ctx(balances));
      if (!res.ok) throw new GameError(res.code, res.error);
      const match = await manager.getRepository(MatchEntity).save(
        manager.getRepository(MatchEntity).create({ roomId: null, gameSlug, status: 'active', state: res.state, version: 1, deadline: engine.deadline(res.state) }),
      );
      const players = userIds.length
        ? await manager.getRepository(MatchPlayerEntity).save(
            userIds.map((userId, i) => manager.getRepository(MatchPlayerEntity).create({ matchId: match.id, userId, seat: engine.seatOf?.(res.state, userId) ?? i })),
          )
        : [];
      const touchedUsers = new Set<string>();
      await this.applyLedger(manager, match.id, res, touchedUsers);
      await this.appendEvents(manager, match.id, null, null, res);
      return { match, players, touchedUsers, finished: false };
    });
    await this.publish(committed);
    return committed.match;
  }

  /** Publishes the effects of a committed start (call after the transaction). */
  async afterStart(committed: Committed) {
    await this.publish(committed);
  }

  /* ---------------- actions & ticks ---------------- */

  act(matchId: string, userId: string, clientActionId: string, action: Record<string, unknown>): Promise<void> {
    if (typeof clientActionId !== 'string' || !/^[\w-]{6,64}$/.test(clientActionId)) {
      return Promise.reject(new GameError('BAD_ACTION_ID', 'clientActionId is required'));
    }
    if (!action || typeof action !== 'object' || JSON.stringify(action).length > 1000) {
      return Promise.reject(new GameError('BAD_ACTION', 'Malformed action'));
    }
    return this.serialize(matchId, async () => {
      const committed = await this.transition(matchId, { kind: 'action', userId, clientActionId, action });
      if (committed) await this.publish(committed);
    });
  }

  /** Takes a seat in a running match; the engine decides whether that is allowed (and takes any buy-in). */
  join(matchId: string, userId: string, action: Record<string, unknown>): Promise<void> {
    return this.serialize(matchId, async () => {
      const committed = await this.transition(matchId, { kind: 'join', userId, action });
      if (committed) await this.publish(committed);
    });
  }

  tick(matchId: string): Promise<void> {
    return this.serialize(matchId, async () => {
      try {
        const committed = await this.transition(matchId, { kind: 'tick' });
        if (committed) await this.publish(committed);
        else {
          // Not due yet (or nothing to do): make sure a timer is armed for the real deadline.
          const m = await this.dataSource.getRepository(MatchEntity).findOne({ where: { id: matchId }, select: ['id', 'status', 'deadline'] });
          if (m?.status === 'active' && !this.timers.has(matchId)) this.schedule(m.id, m.deadline);
        }
      } catch (err) {
        this.logger.error(`Tick failed for ${matchId}: ${(err as Error).message}`);
      }
    });
  }

  private async transition(matchId: string, input: Input): Promise<Committed | null> {
    return this.dataSource.transaction(async (manager) => {
      const match = await manager.getRepository(MatchEntity).findOne({ where: { id: matchId }, lock: { mode: 'pessimistic_write' } });
      if (!match) throw new GameError('NOT_FOUND', 'Match not found', 404);
      if (match.status !== 'active') {
        if (input.kind === 'tick') return null;
        throw new GameError('GAME_OVER', 'This match has ended');
      }
      const engine = engineFor(match.gameSlug);
      let players = await manager.getRepository(MatchPlayerEntity).find({ where: { matchId }, order: { seat: 'ASC' } });
      const joining = input.kind === 'join' && !players.some((p) => p.userId === input.userId);

      if (input.kind === 'action') {
        if (!players.some((p) => p.userId === input.userId)) throw new GameError('NOT_IN_MATCH', 'You are not a player in this match', 403);
        const duplicate = await manager.getRepository(MatchEventEntity).findOneBy({
          matchId,
          userId: input.userId,
          clientActionId: input.clientActionId,
        });
        if (duplicate) return null; // already applied — acknowledge without re-applying
      }

      const balances = await this.ledger.balancesFor(manager, [...players.map((p) => p.userId), ...(joining ? [input.userId] : [])]);
      const ctx = this.ctx(balances);
      const res: EngineResult<unknown> | null =
        input.kind === 'tick' ? engine.tick(match.state, ctx) : engine.act(match.state, input.userId, input.action, ctx);
      if (res === null) return null;
      if (!res.ok) throw new GameError(res.code, res.error);

      const joined: string[] = [];
      if (joining) {
        const repo = manager.getRepository(MatchPlayerEntity);
        players.push(await repo.save(repo.create({ matchId, userId: input.userId, seat: engine.seatOf?.(res.state, input.userId) ?? players.length })));
        joined.push(input.userId);
      }
      const touchedUsers = new Set<string>();
      await this.applyLedger(manager, matchId, res, touchedUsers);
      if (input.kind === 'action') {
        await this.appendEvents(manager, matchId, input.userId, input.clientActionId, res, input.action);
      } else if (input.kind === 'join') {
        await this.appendEvents(manager, matchId, input.userId, null, res, input.action);
      } else {
        await this.appendEvents(manager, matchId, null, null, res);
      }
      // Open tables: whoever stood up leaves the roster (and can sit down again later).
      const dropped: string[] = [];
      const seated = engine.participants?.(res.state);
      if (seated) {
        const keep = new Set(seated);
        const gone = players.filter((p) => !keep.has(p.userId));
        if (gone.length) {
          await manager.getRepository(MatchPlayerEntity).delete({ id: In(gone.map((p) => p.id)) });
          dropped.push(...gone.map((p) => p.userId));
          players = players.filter((p) => keep.has(p.userId));
        }
      }
      match.state = res.state;
      match.version += 1;
      match.deadline = engine.deadline(res.state);
      let finished = false;
      if (engine.isFinished(res.state)) {
        await this.finalize(manager, match, engine, players);
        finished = true;
      }
      await manager.getRepository(MatchEntity).save(match);
      return { match, players, touchedUsers, finished, joined, dropped };
    });
  }

  private async applyLedger(manager: EntityManager, matchId: string, res: EngineResult<unknown>, touched: Set<string>) {
    if (!res.ok) return;
    for (const intent of res.ledger) {
      if (intent.amount === 0) continue;
      const r = await this.ledger.apply(manager, {
        userId: intent.playerId,
        amount: intent.amount,
        type: intent.type,
        description: intent.description,
        key: `match:${matchId}:${intent.key}`,
        matchId,
      });
      if (r.applied) touched.add(intent.playerId);
    }
  }

  private async appendEvents(
    manager: EntityManager,
    matchId: string,
    userId: string | null,
    clientActionId: string | null,
    res: EngineResult<unknown>,
    action?: Record<string, unknown>,
  ) {
    if (!res.ok) return;
    const [{ max }] = await manager.query(`SELECT COALESCE(MAX(seq), 0) AS max FROM match_events WHERE "matchId" = $1`, [matchId]);
    let seq = Number(max);
    const repo = manager.getRepository(MatchEventEntity);
    const rows: Partial<MatchEventEntity>[] = [];
    if (action) {
      rows.push({ matchId, seq: ++seq, userId, clientActionId, type: 'action', payload: { action } });
    }
    for (const e of res.events) {
      rows.push({ matchId, seq: ++seq, userId: e.playerId ?? null, clientActionId: null, type: e.type, payload: e.data ?? {} });
    }
    if (rows.length) await repo.insert(rows as never);
  }

  /** Writes results and statistics. Runs once: guarded by the match row lock and status. */
  private async finalize(manager: EntityManager, match: MatchEntity, engine: GameEngine, players: MatchPlayerEntity[]) {
    const placements = engine.placements(match.state) ?? [];
    const sums: { userId: string; total: string }[] = await manager.query(
      `SELECT "userId", SUM(amount) AS total FROM ledger_entries WHERE "matchId" = $1 GROUP BY "userId"`,
      [match.id],
    );
    const delta = new Map(sums.map((s) => [s.userId, Number(s.total)]));
    for (const p of players) {
      const placement = placements.find((x) => x.playerId === p.userId);
      p.placement = placement?.placement ?? null;
      p.outcome = placement?.outcome ?? 'loss';
      p.pointsDelta = delta.get(p.userId) ?? 0;
      await manager.getRepository(MatchPlayerEntity).save(p);
      await manager.query(
        `INSERT INTO player_stats ("userId", "gameSlug", played, won, lost, drawn, "pointsWon", "updatedAt")
         VALUES ($1, $2, 1, $3, $4, $5, $6, now())
         ON CONFLICT ("userId", "gameSlug") DO UPDATE SET
           played = player_stats.played + 1,
           won = player_stats.won + EXCLUDED.won,
           lost = player_stats.lost + EXCLUDED.lost,
           drawn = player_stats.drawn + EXCLUDED.drawn,
           "pointsWon" = player_stats."pointsWon" + EXCLUDED."pointsWon",
           "updatedAt" = now()`,
        [p.userId, match.gameSlug, p.outcome === 'win' ? 1 : 0, p.outcome === 'loss' ? 1 : 0, p.outcome === 'draw' ? 1 : 0, Math.max(0, p.pointsDelta)],
      );
    }
    match.status = 'finished';
    match.deadline = null;
    match.endedAt = new Date(this.now());
    match.result = { placements };
    if (match.roomId) await manager.getRepository(RoomEntity).update(match.roomId, { status: 'finished' });
  }

  /** Admin: void an active match, refunding each player's unreturned stake. */
  async voidMatch(matchId: string, reason: string): Promise<void> {
    await this.serialize(matchId, async () => {
      const committed = await this.dataSource.transaction(async (manager) => {
        const match = await manager.getRepository(MatchEntity).findOne({ where: { id: matchId }, lock: { mode: 'pessimistic_write' } });
        if (!match) throw new GameError('NOT_FOUND', 'Match not found', 404);
        if (match.status !== 'active') throw new GameError('GAME_OVER', 'Only active matches can be voided');
        const players = await manager.getRepository(MatchPlayerEntity).findBy({ matchId });
        const sums: { userId: string; total: string }[] = await manager.query(
          `SELECT "userId", SUM(amount) AS total FROM ledger_entries WHERE "matchId" = $1 GROUP BY "userId"`,
          [matchId],
        );
        const touchedUsers = new Set<string>();
        for (const s of sums) {
          const net = Number(s.total);
          if (net >= 0) continue;
          await this.ledger.apply(manager, {
            userId: s.userId,
            amount: -net,
            type: 'refund',
            description: `Match voided: ${reason}`.slice(0, 200),
            key: `match:${matchId}:void:${s.userId}`,
            matchId,
          });
          touchedUsers.add(s.userId);
        }
        await manager.getRepository(MatchEventEntity).insert({
          matchId,
          seq: Number((await manager.query(`SELECT COALESCE(MAX(seq),0) AS m FROM match_events WHERE "matchId"=$1`, [matchId]))[0].m) + 1,
          type: 'voided',
          payload: { reason },
        });
        match.status = 'cancelled';
        match.deadline = null;
        match.endedAt = new Date(this.now());
        await manager.getRepository(MatchEntity).save(match);
        if (match.roomId) await manager.getRepository(RoomEntity).update(match.roomId, { status: 'cancelled' });
        return { match, players, touchedUsers, finished: true };
      });
      await this.publish(committed);
    });
  }

  /* ---------------- reads & publishing ---------------- */

  async payloadFor(match: MatchEntity, viewerId: string | null, manager: EntityManager = this.dataSource.manager): Promise<MatchStatePayload> {
    const engine = engineFor(match.gameSlug);
    const players = await manager.getRepository(MatchPlayerEntity).find({ where: { matchId: match.id }, order: { seat: 'ASC' } });
    const users = await manager.getRepository(UserEntity).findBy({ id: In(players.map((p) => p.userId)) });
    const room = match.roomId ? await manager.getRepository(RoomEntity).findOneBy({ id: match.roomId }) : null;
    const online = await this.presence.onlineMap(players.map((p) => p.userId));
    return this.buildPayload(match, engine, players, users, room?.code ?? null, viewerId, online);
  }

  private buildPayload(
    match: MatchEntity,
    engine: GameEngine,
    players: MatchPlayerEntity[],
    users: UserEntity[],
    roomCode: string | null,
    viewerId: string | null,
    online: Record<string, boolean>,
  ): MatchStatePayload {
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      matchId: match.id,
      roomCode,
      gameSlug: match.gameSlug,
      status: match.status,
      version: match.version,
      view: engine.view(match.state, viewerId),
      players: players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        displayName: byId.get(p.userId) ? displayName(byId.get(p.userId)!) : 'Player',
        photoUrl: byId.get(p.userId)?.photoUrl ?? null,
        online: online[p.userId] ?? false,
      })),
      serverTime: this.now(),
    };
  }

  async summaryOf(match: MatchEntity): Promise<MatchSummary> {
    const players = await this.dataSource.getRepository(MatchPlayerEntity).find({ where: { matchId: match.id }, order: { seat: 'ASC' } });
    const users = await this.dataSource.getRepository(UserEntity).findBy({ id: In(players.map((p) => p.userId)) });
    const room = match.roomId ? await this.dataSource.getRepository(RoomEntity).findOneBy({ id: match.roomId }) : null;
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      id: match.id,
      gameSlug: match.gameSlug,
      roomCode: room?.code ?? null,
      status: match.status,
      startedAt: match.startedAt.toISOString(),
      endedAt: match.endedAt?.toISOString() ?? null,
      players: players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        displayName: byId.get(p.userId) ? displayName(byId.get(p.userId)!) : 'Player',
        placement: p.placement,
        outcome: p.outcome,
        pointsDelta: p.pointsDelta,
      })),
    };
  }

  private async publish({ match, players, touchedUsers, finished, joined = [], dropped = [] }: Committed) {
    this.schedule(match.id, match.status === 'active' ? match.deadline : null);
    for (const id of joined) this.broadcaster.leave(id, spectatorChannel(match.id));
    for (const id of dropped) this.broadcaster.join(id, spectatorChannel(match.id));
    try {
      const engine = engineFor(match.gameSlug);
      const users = await this.dataSource.getRepository(UserEntity).findBy({ id: In(players.map((p) => p.userId)) });
      const room = match.roomId ? await this.dataSource.getRepository(RoomEntity).findOneBy({ id: match.roomId }) : null;
      const online = await this.presence.onlineMap(players.map((p) => p.userId));
      for (const p of players) {
        this.broadcaster.toUser(p.userId, 'match:state', this.buildPayload(match, engine, players, users, room?.code ?? null, p.userId, online));
      }
      const spectatorView = this.buildPayload(match, engine, players, users, room?.code ?? null, null, online);
      this.broadcaster.emit(spectatorChannel(match.id), 'match:state', spectatorView);
      for (const id of dropped) this.broadcaster.toUser(id, 'match:state', spectatorView);
      for (const u of users) {
        if (touchedUsers.has(u.id)) this.broadcaster.toUser(u.id, 'balance:update', { balance: u.balance });
      }
      const cashedOut = dropped.filter((id) => touchedUsers.has(id));
      if (cashedOut.length) {
        // Someone who stood up still needs their new balance.
        for (const u of await this.dataSource.getRepository(UserEntity).findBy({ id: In(cashedOut) })) {
          this.broadcaster.toUser(u.id, 'balance:update', { balance: u.balance });
        }
      }
      if (finished) {
        const summary = await this.summaryOf(match);
        for (const p of players) this.broadcaster.toUser(p.userId, 'match:ended', summary);
      }
      if (room) this.broadcaster.emit(roomChannel(room.code), 'room:state', await this.rooms.summary(room));
    } catch (err) {
      this.logger.warn(`Publish failed for ${match.id}: ${(err as Error).message}`);
    }
  }

  async findActiveForUser(userId: string): Promise<MatchEntity[]> {
    return this.dataSource
      .getRepository(MatchEntity)
      .createQueryBuilder('m')
      .innerJoin(MatchPlayerEntity, 'mp', 'mp."matchId" = m.id')
      .where('mp."userId" = :userId', { userId })
      .andWhere(`m.status = 'active'`)
      .select(['m.id', 'm.gameSlug', 'm.roomId', 'm.status', 'm.version', 'm.startedAt', 'm.endedAt', 'm.deadline'])
      .getMany();
  }

  async getMatch(matchId: string): Promise<MatchEntity | null> {
    return this.dataSource.getRepository(MatchEntity).findOneBy({ id: matchId });
  }

  async isPlayer(matchId: string, userId: string): Promise<boolean> {
    return (await this.dataSource.getRepository(MatchPlayerEntity).countBy({ matchId, userId })) > 0;
  }

  /** Re-sends a user's active matches to everyone so connection badges update. */
  async refreshPresence(userId: string): Promise<void> {
    for (const { id } of await this.findActiveForUser(userId)) {
      await this.serialize(id, async () => {
        const match = await this.getMatch(id);
        if (match?.status !== 'active') return;
        const players = await this.dataSource.getRepository(MatchPlayerEntity).find({ where: { matchId: id }, order: { seat: 'ASC' } });
        await this.publish({ match, players, touchedUsers: new Set(), finished: false });
      });
    }
  }

  countActive(): Promise<number> {
    return this.dataSource.getRepository(MatchEntity).countBy({ status: 'active' });
  }
}
