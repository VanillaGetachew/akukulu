/**
 * The one and only game catalog. Every layer (seed data, registry, API, lobby,
 * bot, docs) derives its list of games from here.
 */
export const GAME_SLUGS = ['ludo', 'poker', 'blackjack', 'conquer'] as const;
export type GameSlug = (typeof GAME_SLUGS)[number];

export function isGameSlug(value: unknown): value is GameSlug {
  return typeof value === 'string' && (GAME_SLUGS as readonly string[]).includes(value);
}

export interface GameCatalogEntry {
  slug: GameSlug;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Rooms are skipped and a solo table is created directly (Blackjack). */
  solo: boolean;
  sortOrder: number;
  /** Seed value only; admins can toggle at runtime. */
  defaultMaintenance: boolean;
  maintenanceMessage?: string;
  /** Playable, but some rules still await confirmation. */
  beta?: boolean;
}

export const GAME_CATALOG: readonly GameCatalogEntry[] = [
  {
    slug: 'ludo',
    name: 'Ludo',
    tagline: 'Roll, race and capture',
    description: 'Classic multiplayer dice-and-board race for 2–4 players. First to bring all four tokens home wins.',
    minPlayers: 2,
    maxPlayers: 4,
    solo: false,
    sortOrder: 1,
    defaultMaintenance: false,
  },
  {
    slug: 'poker',
    name: 'Poker',
    tagline: "Texas Hold'em",
    description: "No-limit Texas Hold'em sit-and-go for 2–9 players with side pots and a full hand evaluator.",
    minPlayers: 2,
    maxPlayers: 9,
    solo: false,
    sortOrder: 2,
    defaultMaintenance: false,
  },
  {
    slug: 'blackjack',
    name: 'Blackjack',
    tagline: 'Beat the dealer to 21',
    description: 'Player-versus-dealer Blackjack from a six-deck shoe. Hit, stand, double and split.',
    minPlayers: 1,
    maxPlayers: 1,
    solo: true,
    sortOrder: 3,
    defaultMaintenance: false,
  },
  {
    slug: 'conquer',
    name: 'Conquer',
    tagline: 'ካርታ ኮንከር · 1v1 melding',
    description: 'Ethiopian Conquer for two players: predict the wildcards, open with 41 points, meld every card and discard your last.',
    minPlayers: 2,
    maxPlayers: 2,
    solo: false,
    sortOrder: 4,
    defaultMaintenance: false,
  },
];

/** Message seeded while Conquer had no engine; cleared automatically once it does. */
export const LEGACY_CONQUER_MAINTENANCE_MESSAGE = 'Conquer is coming soon — the official ruleset is being finalized.';

export function getCatalogEntry(slug: GameSlug): GameCatalogEntry {
  const entry = GAME_CATALOG.find((g) => g.slug === slug);
  if (!entry) throw new Error(`Unknown game: ${slug}`);
  return entry;
}

/** Virtual-points economy constants. Points are free, non-transferable and non-redeemable. */
export const ECONOMY = {
  welcomeBonus: 1000,
  dailyReward: 200,
  referralReward: 300,
} as const;
