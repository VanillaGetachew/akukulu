import type { GameSlug } from '@akukulu/shared';
import type { GameEngine } from './core';
import { ludoEngine } from './ludo/ludo.engine';
import { pokerEngine } from './poker/poker.engine';
import { blackjackEngine } from './blackjack/blackjack.engine';
import { conquerEngine } from './conquer/conquer.engine';

export * from './core';
export * from './ludo/ludo.engine';
export * from './poker/poker.engine';
export * from './poker/hand-evaluator';
export * from './blackjack/blackjack.engine';
export * from './conquer/conquer.engine';
export * as conquerRules from './conquer/rules';

/** Engines that are implemented and playable. */

export const ENGINES: Partial<Record<GameSlug, GameEngine<any, any>>> = {
  ludo: ludoEngine,
  poker: pokerEngine,
  blackjack: blackjackEngine,
  conquer: conquerEngine,
};

export function getEngine(slug: GameSlug): GameEngine<any, any> | null {
  return ENGINES[slug] ?? null;
}
