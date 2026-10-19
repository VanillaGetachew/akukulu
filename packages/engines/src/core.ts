import { randomInt } from 'node:crypto';
import type { GameSlug, GameView, MatchOutcome } from '@akukulu/shared';

/** Source of randomness. Production always uses {@link cryptoRng}. */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(maxExclusive),
};

/** Deterministic RNG for tests and simulations only (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(maxExclusive) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * maxExclusive);
    },
  };
}

/** RNG that replays a fixed sequence of values (tests only). */
export function scriptedRng(values: number[]): Rng {
  let i = 0;
  return {
    int(maxExclusive) {
      if (i >= values.length) throw new Error('scriptedRng exhausted');
      const v = values[i++];
      if (v < 0 || v >= maxExclusive) throw new Error(`scripted value ${v} out of range ${maxExclusive}`);
      return v;
    },
  };
}

/** Fisher–Yates shuffle returning a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface EngineContext {
  rng: Rng;
  /** Server time in ms. */
  now: number;
  /** Current virtual-point balance of each seated player (used for affordability checks). */
  balances: Record<string, number>;
}

/**
 * A request for the runtime to move virtual points. Applied atomically with the
 * state transition; `key` is unique within a match so replays are no-ops.
 */
export interface LedgerIntent {
  playerId: string;
  /** Signed: negative debits the player, positive credits them. */
  amount: number;
  key: string;
  type: 'stake' | 'payout' | 'buyin' | 'cashout' | 'bet' | 'refund';
  description: string;
}

export interface EngineEvent {
  type: string;
  playerId?: string;
  data?: Record<string, unknown>;
}

export interface Placement {
  playerId: string;
  placement: number;
  outcome: MatchOutcome;
}

export interface SeatedPlayer {
  playerId: string;
  seat: number;
}

export type EngineResult<S> =
  | { ok: true; state: S; events: EngineEvent[]; ledger: LedgerIntent[] }
  | { ok: false; code: string; error: string };

export function ok<S>(state: S, events: EngineEvent[] = [], ledger: LedgerIntent[] = []): EngineResult<S> {
  return { ok: true, state, events, ledger };
}

export function fail<S = never>(code: string, error: string): EngineResult<S> {
  return { ok: false, code, error };
}

export class ConfigError extends Error {}

export interface GameEngine<S = unknown, C = unknown> {
  readonly slug: GameSlug;
  /** Merge user-supplied options with defaults and validate. Throws ConfigError. */
  parseConfig(input: unknown, stake: number): C;
  playerLimits(config: C): { min: number; max: number };
  start(players: SeatedPlayer[], config: C, ctx: EngineContext): EngineResult<S>;
  act(state: S, playerId: string, action: unknown, ctx: EngineContext): EngineResult<S>;
  /** Called once the deadline has passed; null when nothing is due. */
  tick(state: S, ctx: EngineContext): EngineResult<S> | null;
  deadline(state: S): number | null;
  isFinished(state: S): boolean;
  placements(state: S): Placement[] | null;
  /** Personalised view: never contains information the viewer is not entitled to. */
  view(state: S, viewerId: string | null): GameView;
}

/** Deep clone for immutable state transitions (state is plain JSON). */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function intInRange(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export function actionType(action: unknown): string | null {
  const t = asRecord(action).type;
  return typeof t === 'string' ? t : null;
}
