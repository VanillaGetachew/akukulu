import type { GameSlug } from '@akukulu/shared';
import type { GameEngine } from './core';
import { ludoEngine } from './ludo/ludo.engine';
import { pokerEngine } from './poker/poker.engine';
import { blackjackEngine } from './blackjack/blackjack.engine';

export * from './core';
export * from './ludo/ludo.engine';
export * from './poker/poker.engine';
export * from './poker/hand-evaluator';
export * from './blackjack/blackjack.engine';

/**
 * Engines that are implemented and playable. Conquer is intentionally absent
 * until its ruleset is finalized (see docs/GAMES/CONQUER_RULES.md).
 */
export const ENGINES: Partial<Record<GameSlug, GameEngine<any, any>>> = {
  ludo: ludoEngine,
  poker: pokerEngine,
  blackjack: blackjackEngine,
};

export function getEngine(slug: GameSlug): GameEngine<any, any> | null {
  return ENGINES[slug] ?? null;
}
