import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, Not, In } from 'typeorm';
import { getEngine } from '@akukulu/engines';
import { GAME_CATALOG, GAME_SLUGS, LEGACY_CONQUER_MAINTENANCE_MESSAGE, NO_ENGINE_MAINTENANCE_MESSAGE, getCatalogEntry, type GameSlug, type GameSummary } from '@akukulu/shared';
import { GameEntity } from '../database/entities';
import { GameError } from '../common/util';

/** The lobby refreshes every 8 seconds; two missed refreshes and the player has gone. */
const LOBBY_PRESENCE_MS = 20_000;

@Injectable()
export class GamesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GamesService.name);

  /** Who has a game's lobby open: user id to when they were last seen there. */
  private readonly lobby = new Map<GameSlug, Map<string, number>>();

  constructor(private readonly dataSource: DataSource) {}

  seenInLobby(slug: GameSlug, userId: string) {
    let seen = this.lobby.get(slug);
    if (!seen) this.lobby.set(slug, (seen = new Map()));
    seen.set(userId, Date.now());
  }

  private inLobby(slug: GameSlug): string[] {
    const seen = this.lobby.get(slug);
    if (!seen) return [];
    const cutoff = Date.now() - LOBBY_PRESENCE_MS;
    for (const [userId, at] of seen) if (at < cutoff) seen.delete(userId);
    return [...seen.keys()];
  }

  async onApplicationBootstrap() {
    await this.syncCatalog();
  }

  /**
   * Makes the `games` table match the catalog exactly: inserts missing games,
   * refreshes copy, and deletes anything that is not in the catalog.
   * Admin toggles (enabled / maintenance) are preserved for existing rows.
   */
  async syncCatalog() {
    const repo = this.dataSource.getRepository(GameEntity);
    const removed = await repo.delete({ slug: Not(In([...GAME_SLUGS])) });
    if (removed.affected) this.logger.warn(`Removed ${removed.affected} game(s) not in the catalog`);
    for (const entry of GAME_CATALOG) {
      const existing = await repo.findOneBy({ slug: entry.slug });
      const copy = {
        name: entry.name,
        tagline: entry.tagline,
        description: entry.description,
        minPlayers: entry.minPlayers,
        maxPlayers: entry.maxPlayers,
        solo: entry.solo,
        sortOrder: entry.sortOrder,
      };
      if (existing) {
        // A game without an engine can never leave maintenance.
        const forceMaintenance = !getEngine(entry.slug);
        // Lift automatic maintenance ("rules pending", or seeded before the engine was loaded) once an engine exists. Admin toggles are kept.
        const automatic = existing.maintenanceMessage === LEGACY_CONQUER_MAINTENANCE_MESSAGE || existing.maintenanceMessage === NO_ENGINE_MAINTENANCE_MESSAGE;
        const liftLegacy = !forceMaintenance && existing.maintenance && automatic;
        await repo.update(entry.slug, {
          ...copy,
          ...(forceMaintenance
            ? { maintenance: true, maintenanceMessage: entry.maintenanceMessage ?? existing.maintenanceMessage ?? NO_ENGINE_MAINTENANCE_MESSAGE }
            : {}),
          ...(liftLegacy ? { maintenance: false, maintenanceMessage: null } : {}),
        });
      } else {
        await repo.insert({
          slug: entry.slug,
          ...copy,
          enabled: true,
          maintenance: entry.defaultMaintenance || !getEngine(entry.slug),
          maintenanceMessage: entry.maintenanceMessage ?? (getEngine(entry.slug) ? null : NO_ENGINE_MAINTENANCE_MESSAGE),
        });
      }
    }
  }

  async list(): Promise<GameSummary[]> {
    const games = await this.dataSource.getRepository(GameEntity).find({ order: { sortOrder: 'ASC' } });
    const counts: { gameSlug: GameSlug; rooms: string }[] = await this.dataSource.query(`
      SELECT "gameSlug", COUNT(*) AS rooms FROM rooms WHERE status = 'waiting' AND visibility = 'public' GROUP BY "gameSlug"`);
    // Everyone inside a game: waiting in a room, seated in a match (poker tables and tournaments too), or looking at its lobby.
    const seated: { gameSlug: GameSlug; userId: string }[] = await this.dataSource.query(`
      SELECT r."gameSlug", rp."userId" FROM rooms r JOIN room_players rp ON rp."roomId" = r.id WHERE r.status IN ('waiting', 'in_progress')
      UNION
      SELECT m."gameSlug", mp."userId" FROM matches m JOIN match_players mp ON mp."matchId" = m.id WHERE m.status = 'active'`);
    const inside = new Map<GameSlug, Set<string>>(games.map((g) => [g.slug, new Set(this.inLobby(g.slug))]));
    for (const row of seated) inside.get(row.gameSlug)?.add(row.userId);
    const rooms = new Map(counts.map((c) => [c.gameSlug, Number(c.rooms)]));
    return games.map((g) => this.toSummary(g, inside.get(g.slug)?.size ?? 0, rooms.get(g.slug) ?? 0));
  }

  toSummary(g: GameEntity, activePlayers = 0, openRooms = 0): GameSummary {
    return {
      slug: g.slug,
      name: g.name,
      tagline: g.tagline,
      description: g.description,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      solo: g.solo,
      enabled: g.enabled,
      maintenance: g.maintenance,
      maintenanceMessage: g.maintenanceMessage,
      activePlayers,
      openRooms,
      playable: g.enabled && !g.maintenance && getEngine(g.slug) !== null,
      beta: getCatalogEntry(g.slug).beta ?? false,
    };
  }

  async requirePlayable(slug: GameSlug): Promise<GameEntity> {
    const game = await this.dataSource.getRepository(GameEntity).findOneBy({ slug });
    if (!game) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    if (!game.enabled) throw new GameError('GAME_DISABLED', `${game.name} is currently disabled`);
    if (game.maintenance || !getEngine(slug)) {
      throw new GameError('GAME_MAINTENANCE', game.maintenanceMessage ?? `${game.name} is under maintenance`, 503);
    }
    return game;
  }

  async update(slug: GameSlug, patch: { enabled?: boolean; maintenance?: boolean; maintenanceMessage?: string | null }) {
    const repo = this.dataSource.getRepository(GameEntity);
    const game = await repo.findOneBy({ slug });
    if (!game) throw new GameError('UNKNOWN_GAME', 'Unknown game', 404);
    if (patch.maintenance === false && !getEngine(slug)) {
      throw new GameError('NO_ENGINE', `${game.name} has no rules engine yet and must stay in maintenance`);
    }
    Object.assign(game, patch);
    return this.toSummary(await repo.save(game));
  }
}
