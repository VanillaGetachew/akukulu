import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, Not, In } from 'typeorm';
import { getEngine } from '@akukulu/engines';
import { GAME_CATALOG, GAME_SLUGS, LEGACY_CONQUER_MAINTENANCE_MESSAGE, getCatalogEntry, type GameSlug, type GameSummary } from '@akukulu/shared';
import { GameEntity } from '../database/entities';
import { GameError } from '../common/util';

@Injectable()
export class GamesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GamesService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    await this.syncCatalog();
  }

  /**
   * Makes the `games` table match the catalog exactly: inserts missing games,
   * refreshes copy, and deletes anything that is not one of the four games.
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
        // Lift the automatic "rules pending" maintenance once an engine exists (admin toggles are kept).
        const liftLegacy = !forceMaintenance && existing.maintenance && existing.maintenanceMessage === LEGACY_CONQUER_MAINTENANCE_MESSAGE;
        await repo.update(entry.slug, {
          ...copy,
          ...(forceMaintenance ? { maintenance: true, maintenanceMessage: entry.maintenanceMessage ?? existing.maintenanceMessage } : {}),
          ...(liftLegacy ? { maintenance: false, maintenanceMessage: null } : {}),
        });
      } else {
        await repo.insert({
          slug: entry.slug,
          ...copy,
          enabled: true,
          maintenance: entry.defaultMaintenance || !getEngine(entry.slug),
          maintenanceMessage: entry.maintenanceMessage ?? null,
        });
      }
    }
  }

  async list(): Promise<GameSummary[]> {
    const games = await this.dataSource.getRepository(GameEntity).find({ order: { sortOrder: 'ASC' } });
    const counts: { gameSlug: GameSlug; players: string; rooms: string }[] = await this.dataSource.query(`
      SELECT r."gameSlug",
             COUNT(DISTINCT rp."userId") AS players,
             COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'waiting' AND r.visibility = 'public') AS rooms
      FROM rooms r
      LEFT JOIN room_players rp ON rp."roomId" = r.id
      WHERE r.status IN ('waiting', 'in_progress')
      GROUP BY r."gameSlug"`);
    const bySlug = new Map(counts.map((c) => [c.gameSlug, c]));
    return games.map((g) => this.toSummary(g, Number(bySlug.get(g.slug)?.players ?? 0), Number(bySlug.get(g.slug)?.rooms ?? 0)));
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
