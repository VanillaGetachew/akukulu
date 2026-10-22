import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { describeHand, mttPrizePool, type PokerMttState, type PokerState } from '@akukulu/engines';
import {
  POKER_CASH_STAKES,
  pokerMttPayouts,
  type Card,
  type PokerCashTableSummary,
  type PokerHandHistory,
  type PokerTournamentSummary,
} from '@akukulu/shared';
import { MatchEntity, MatchEventEntity, TournamentEntity, TournamentEntryEntity, UserEntity } from '../database/entities';
import { MatchRuntimeService } from '../matches/match-runtime.service';
import { LedgerService } from '../wallet/ledger.service';
import { GameError, displayName } from '../common/util';

const SWEEP_MS = 5_000;
/** Names for the always-open cash tables, one per stake level; a second table at a level gets " II". */
const TABLE_NAMES = ['Addis', 'Lalibela', 'Gondar', 'Axum'];

export interface TournamentInput {
  name: string;
  startsAt: Date;
  buyIn: number;
  guarantee: number;
  startingStack: number;
  levelMinutes: number;
  lateRegLevels: number;
  maxEntrants: number;
  tableSize: number;
}

interface HandSummaryPayload {
  handNumber: number;
  tableName: string | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  board: Card[];
  button: string | null;
  seats: { playerId: string; seat: number; startStack: number; net: number; hole: Card[] }[];
  shown: { playerId: string; label: string | null }[];
  actions: { playerId: string; street: string; action: string }[];
  pots: { amount: number; winners: string[] }[];
}

/** Hides hole cards that the viewer is not entitled to: their own, and hands shown down. */
export function redactHandSummary(payload: Record<string, unknown>, viewerId: string | null): Record<string, unknown> {
  const p = payload as unknown as HandSummaryPayload;
  if (!Array.isArray(p.seats)) return payload;
  const shown = new Set((p.shown ?? []).map((s) => s.playerId));
  return { ...payload, seats: p.seats.map((s) => ({ ...s, hole: s.playerId === viewerId || shown.has(s.playerId) ? s.hole : null })) };
}

/**
 * Poker lobby: the always-open cash tables and the scheduled tournaments that
 * administrators create. Tables and tournaments are ordinary matches run by the
 * match runtime; this service seats people, takes tournament buy-ins and starts
 * tournaments on time.
 */
@Injectable()
export class PokerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PokerService.name);
  private handle: NodeJS.Timeout | null = null;
  now: () => number = () => Date.now();

  constructor(
    private readonly dataSource: DataSource,
    private readonly runtime: MatchRuntimeService,
    private readonly ledger: LedgerService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.ensureCashTables();
    } catch (err) {
      this.logger.warn(`Could not open the cash tables: ${(err as Error).message}`);
    }
    if (process.env.DISABLE_MATCH_SWEEP !== 'true') {
      this.handle = setInterval(() => void this.sweep(), SWEEP_MS);
    }
  }

  onModuleDestroy() {
    if (this.handle) clearInterval(this.handle);
  }

  async sweep() {
    try {
      await this.startDueTournaments();
      await this.closeFinishedTournaments();
    } catch (err) {
      this.logger.warn(`Tournament sweep failed: ${(err as Error).message}`);
    }
  }

  /* ---------------- cash tables ---------------- */

  private async cashMatches(): Promise<MatchEntity[]> {
    return this.dataSource
      .getRepository(MatchEntity)
      .createQueryBuilder('m')
      .where(`m."gameSlug" = 'poker' AND m.status = 'active' AND m.state->'config'->>'permanent' = 'true'`)
      .orderBy('m."startedAt"', 'ASC')
      .getMany();
  }

  /** Every stake level always has a table with a free seat. */
  async ensureCashTables() {
    const matches = await this.cashMatches();
    for (const [i, stake] of POKER_CASH_STAKES.entries()) {
      const atStake = matches.filter((m) => (m.state as PokerState).config.bigBlind === stake.bigBlind);
      const hasSeat = atStake.some((m) => {
        const s = m.state as PokerState;
        return s.players.length < s.config.maxSeats;
      });
      if (hasSeat) continue;
      const base = `${TABLE_NAMES[i] ?? 'Table'} ${stake.smallBlind}/${stake.bigBlind}`;
      const tableName = atStake.length ? `${base} ${['II', 'III', 'IV', 'V', 'VI'][atStake.length - 1] ?? atStake.length + 1}` : base;
      await this.runtime.startStandalone('poker', { permanent: true, ...stake, tableName }, 0, []);
    }
  }

  async cashTables(userId: string): Promise<PokerCashTableSummary[]> {
    return (await this.cashMatches())
      .map((m) => {
        const s = m.state as PokerState;
        const seated = s.players.filter((p) => p.status === 'active');
        return {
          matchId: m.id,
          name: s.config.tableName ?? `${s.config.smallBlind}/${s.config.bigBlind}`,
          smallBlind: s.config.smallBlind,
          bigBlind: s.config.bigBlind,
          minBuyIn: s.config.minBuyIn ?? s.config.bigBlind * 40,
          maxBuyIn: s.config.buyIn,
          seated: seated.length,
          maxSeats: s.config.maxSeats,
          seatedHere: seated.some((p) => p.playerId === userId),
        };
      })
      .sort((a, b) => a.bigBlind - b.bigBlind || a.name.localeCompare(b.name));
  }

  async sit(userId: string, matchId: string, buyIn: number, seat?: number) {
    const match = await this.runtime.getMatch(matchId);
    if (!match || match.status !== 'active' || !(match.state as PokerState).config?.permanent) throw new GameError('NOT_FOUND', 'Table not found', 404);
    await this.runtime.join(matchId, userId, { type: 'sit', buyIn, ...(seat === undefined ? {} : { seat }) });
    await this.ensureCashTables();
    return { ok: true };
  }

  /* ---------------- hand history ---------------- */

  async handHistory(userId: string, matchId: string | null, limit: number): Promise<PokerHandHistory[]> {
    const rows: { matchId: string; payload: Record<string, unknown>; createdAt: Date }[] = await this.dataSource.query(
      `SELECT "matchId", payload, "createdAt" FROM match_events
       WHERE type = 'hand_summary' AND payload->'seats' @> $1::jsonb AND ($2::uuid IS NULL OR "matchId" = $2)
       ORDER BY "createdAt" DESC, seq DESC LIMIT $3`,
      [JSON.stringify([{ playerId: userId }]), matchId, limit],
    );
    const payloads = rows.map((r) => r.payload as unknown as HandSummaryPayload);
    const ids = [...new Set(payloads.flatMap((p) => p.seats.map((s) => s.playerId)))];
    const users = ids.length ? await this.dataSource.getRepository(UserEntity).findBy({ id: In(ids) }) : [];
    const names = new Map(users.map((u) => [u.id, displayName(u)]));
    return rows.map((row, i) => {
      const p = payloads[i];
      const labels = new Map((p.shown ?? []).map((s) => [s.playerId, s.label]));
      return {
        matchId: row.matchId,
        handNumber: p.handNumber,
        at: new Date(row.createdAt).toISOString(),
        tableName: p.tableName,
        smallBlind: p.smallBlind,
        bigBlind: p.bigBlind,
        ante: p.ante,
        board: p.board,
        players: p.seats.map((s) => {
          const visible = s.playerId === userId || labels.has(s.playerId);
          return {
            playerId: s.playerId,
            displayName: names.get(s.playerId) ?? 'Player',
            seat: s.seat,
            startStack: s.startStack,
            net: s.net,
            hole: visible ? s.hole : null,
            handLabel: labels.get(s.playerId) ?? (visible && s.hole.length === 2 ? describeHand([...s.hole, ...p.board]) : null),
            button: s.playerId === p.button,
          };
        }),
        actions: p.actions,
        pots: p.pots,
      };
    });
  }

  /* ---------------- tournaments ---------------- */

  private lateRegOpen(t: TournamentEntity, match: MatchEntity | null) {
    if (t.status !== 'running' || !match || match.status !== 'active' || !t.lateRegLevels) return false;
    const s = match.state as PokerMttState;
    return this.now() < s.startedAt + t.lateRegLevels * t.levelMinutes * 60_000;
  }

  async listTournaments(userId: string | null, includeOld = false): Promise<PokerTournamentSummary[]> {
    const qb = this.dataSource.getRepository(TournamentEntity).createQueryBuilder('t');
    if (!includeOld) {
      qb.where(`t.status IN ('scheduled', 'running') OR (t.status = 'finished' AND t."updatedAt" > now() - interval '1 day')`);
    }
    const list = await qb.orderBy(`CASE t.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END`).addOrderBy('t."startsAt"', 'ASC').take(100).getMany();
    return this.summaries(list, userId);
  }

  async tournament(id: string, userId: string | null): Promise<PokerTournamentSummary> {
    const t = await this.load(id);
    return (await this.summaries([t], userId))[0];
  }

  private async load(id: string): Promise<TournamentEntity> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
    const t = await this.dataSource.getRepository(TournamentEntity).findOneBy({ id });
    if (!t) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
    return t;
  }

  private async summaries(list: TournamentEntity[], userId: string | null): Promise<PokerTournamentSummary[]> {
    if (!list.length) return [];
    const ids = list.map((t) => t.id);
    const counts: { tournamentId: string; count: number }[] = await this.dataSource.query(
      `SELECT "tournamentId", COUNT(*)::int AS count FROM tournament_entries WHERE "tournamentId" = ANY($1) GROUP BY "tournamentId"`,
      [ids],
    );
    const mine = userId ? await this.dataSource.getRepository(TournamentEntryEntity).findBy({ userId, tournamentId: In(ids) }) : [];
    const matchIds = list.map((t) => t.matchId).filter((m): m is string => !!m);
    const matches = matchIds.length ? await this.dataSource.getRepository(MatchEntity).findBy({ id: In(matchIds) }) : [];
    return list.map((t) => {
      const registered = counts.find((c) => c.tournamentId === t.id)?.count ?? 0;
      const match = matches.find((m) => m.id === t.matchId) ?? null;
      const s = match?.state as PokerMttState | undefined;
      const entrants = s?.entrants ?? registered;
      const prizePool = s ? mttPrizePool(s) : Math.max(t.guarantee, t.buyIn * registered);
      const playersLeft = s ? s.tables.reduce((n, table) => n + table.players.filter((p) => p.status === 'active').length, 0) : null;
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        startsAt: t.startsAt.toISOString(),
        buyIn: t.buyIn,
        guarantee: t.guarantee,
        prizePool,
        startingStack: t.startingStack,
        levelMinutes: t.levelMinutes,
        lateRegLevels: t.lateRegLevels,
        maxEntrants: t.maxEntrants,
        tableSize: t.tableSize,
        registered: entrants,
        isRegistered: mine.some((e) => e.tournamentId === t.id),
        matchId: t.matchId,
        canRegister: (t.status === 'scheduled' && registered < t.maxEntrants) || (this.lateRegOpen(t, match) && entrants < t.maxEntrants),
        payouts: pokerMttPayouts(prizePool, Math.max(2, entrants)),
        playersLeft,
      };
    });
  }

  async register(userId: string, id: string): Promise<PokerTournamentSummary> {
    const entry = await this.dataSource.transaction(async (manager) => {
      const t = await manager.getRepository(TournamentEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new GameError('NOT_FOUND', 'Tournament not found', 404);
      const match = t.matchId ? await manager.getRepository(MatchEntity).findOneBy({ id: t.matchId }) : null;
      if (t.status !== 'scheduled' && !this.lateRegOpen(t, match)) throw new GameError('REGISTRATION_CLOSED', 'Registration is closed');
      const repo = manager.getRepository(TournamentEntryEntity);
      if (await repo.countBy({ tournamentId: id, userId })) throw new GameError('ALREADY_REGISTERED', 'You are already registered');
      if ((await repo.countBy({ tournamentId: id })) >= t.maxEntrants) throw new GameError('TOURNAMENT_FULL', 'This tournament is full');
      const e = await repo.save(repo.create({ tournamentId: id, userId }));
      if (t.buyIn > 0) {
        await this.ledger.apply(manager, { userId, amount: -t.buyIn, type: 'buyin', description: `${t.name}: buy-in`, key: `tournament:${id}:buyin:${e.id}` });
      }
      return { e, t };
    });
    if (entry.t.status === 'running' && entry.t.matchId) {
      // Late registration: take a seat in the running tournament, or give the buy-in back.
      try {
        await this.runtime.join(entry.t.matchId, userId, { type: 'register' });
      } catch (err) {
        await this.refundEntry(entry.t, entry.e, 'late registration failed');
        throw err;
      }
    }
    return this.tournament(id, userId);
  }

  async unregister(userId: string, id: string): Promise<PokerTournamentSummary> {
    const t = await this.load(id);
    if (t.status !== 'scheduled') throw new GameError('TOURNAMENT_STARTED', 'The tournament has already started');
    const e = await this.dataSource.getRepository(TournamentEntryEntity).findOneBy({ tournamentId: id, userId });
    if (!e) throw new GameError('NOT_REGISTERED', 'You are not registered');
    await this.refundEntry(t, e, 'unregistered');
    return this.tournament(id, userId);
  }

  private async refundEntry(t: TournamentEntity, e: TournamentEntryEntity, reason: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(TournamentEntryEntity).delete({ id: e.id });
      if (t.buyIn > 0) {
        await this.ledger.apply(manager, { userId: e.userId, amount: t.buyIn, type: 'refund', description: `${t.name}: buy-in returned (${reason})`, key: `tournament:${t.id}:refund:${e.id}` });
      }
    });
  }

  /** Starts every tournament whose time has come (or cancels it when fewer than two registered). */
  async startDueTournaments() {
    const due = await this.dataSource
      .getRepository(TournamentEntity)
      .createQueryBuilder('t')
      .where(`t.status = 'scheduled' AND t."startsAt" <= :now`, { now: new Date(this.now()) })
      .getMany();
    for (const t of due) {
      // Claim it first: two sweeps never start the same tournament, and registration closes before the field is read.
      const claimed = await this.dataSource.getRepository(TournamentEntity).update({ id: t.id, status: 'scheduled' }, { status: 'running' });
      if (!claimed.affected) continue;
      const entries = await this.dataSource.getRepository(TournamentEntryEntity).find({ where: { tournamentId: t.id }, order: { createdAt: 'ASC' } });
      if (entries.length < 2) {
        await this.cancel(t.id, 'not enough players');
        continue;
      }
      try {
        const match = await this.runtime.startStandalone(
          'poker',
          {
            mode: 'mtt',
            tournamentId: t.id,
            name: t.name,
            guarantee: t.guarantee,
            startingStack: t.startingStack,
            levelMinutes: t.levelMinutes,
            lateRegLevels: t.lateRegLevels,
            maxSeats: t.tableSize,
          },
          t.buyIn,
          entries.map((e) => e.userId),
        );
        await this.dataSource.getRepository(TournamentEntity).update(t.id, { matchId: match.id });
      } catch (err) {
        this.logger.error(`Could not start tournament ${t.id}: ${(err as Error).message}`);
        await this.cancel(t.id, 'could not start');
      }
    }
  }

  async closeFinishedTournaments() {
    await this.dataSource.query(
      `UPDATE tournaments t SET status = CASE m.status WHEN 'finished' THEN 'finished' ELSE 'cancelled' END, "updatedAt" = now()
       FROM matches m WHERE t.status = 'running' AND t."matchId" = m.id AND m.status IN ('finished', 'cancelled')`,
    );
  }

  /* ---------------- administration ---------------- */

  async create(input: TournamentInput, adminId: string | null): Promise<PokerTournamentSummary> {
    if (input.startsAt.getTime() < this.now() - 60_000) throw new GameError('BAD_START', 'The start time is in the past');
    const repo = this.dataSource.getRepository(TournamentEntity);
    const t = await repo.save(repo.create({ ...input, gameSlug: 'poker', status: 'scheduled', createdBy: adminId }));
    return this.tournament(t.id, null);
  }

  async update(id: string, input: Partial<TournamentInput>): Promise<PokerTournamentSummary> {
    const t = await this.load(id);
    if (t.status !== 'scheduled') throw new GameError('TOURNAMENT_STARTED', 'Only tournaments that have not started can be edited');
    if (input.buyIn !== undefined && input.buyIn !== t.buyIn && (await this.dataSource.getRepository(TournamentEntryEntity).countBy({ tournamentId: id }))) {
      throw new GameError('HAS_ENTRIES', 'The buy-in cannot change once players have registered');
    }
    await this.dataSource.getRepository(TournamentEntity).update(id, input);
    return this.tournament(id, null);
  }

  /** Cancels a tournament and returns every buy-in; a running one has its match voided. */
  async cancel(id: string, reason: string): Promise<PokerTournamentSummary> {
    const t = await this.load(id);
    if (t.status === 'finished' || t.status === 'cancelled') throw new GameError('TOURNAMENT_OVER', 'This tournament is already over');
    if (t.status === 'running' && t.matchId) {
      const match = await this.runtime.getMatch(t.matchId);
      if (match?.status === 'active') await this.runtime.voidMatch(t.matchId, `Tournament cancelled: ${reason}`);
    }
    await this.dataSource.getRepository(TournamentEntity).update(id, { status: 'cancelled' });
    for (const e of await this.dataSource.getRepository(TournamentEntryEntity).findBy({ tournamentId: id })) {
      if (t.buyIn > 0) {
        await this.ledger.applyStandalone({ userId: e.userId, amount: t.buyIn, type: 'refund', description: `${t.name}: cancelled (${reason})`, key: `tournament:${id}:cancel:${e.id}` });
      }
    }
    return this.tournament(id, null);
  }

  /** The event log entries players may see, with other players' hidden cards removed. */
  static redactEvents(events: MatchEventEntity[], viewerId: string | null) {
    return events.map((e) => (e.type === 'hand_summary' ? { ...e, payload: redactHandSummary(e.payload, viewerId) } : e));
  }
}
