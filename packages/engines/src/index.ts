import type { GameSlug } from '@akukulu/shared';
import type { GameEngine } from './core';
import { ludoEngine } from './ludo/ludo.engine';
import { pokerGameEngine } from './poker/poker-mtt';
import { blackjackEngine } from './blackjack/blackjack.engine';
import { conquerEngine } from './conquer/conquer.engine';
import { crazyEngine } from './crazy/crazy.engine';
import { penaltyEngine } from './penalty/penalty.engine';
import { rpsEngine } from './rps/rps.engine';
import { bingoEngine } from './bingo/bingo.engine';

export * from './core';
export * from './ludo/ludo.engine';
export * from './poker/poker.engine';
export * from './poker/poker-mtt';
export * from './poker/hand-evaluator';
export * from './blackjack/blackjack.engine';
export * from './conquer/conquer.engine';
export * as conquerRules from './conquer/rules';
export * from './crazy/crazy.engine';
export * from './penalty/penalty.engine';
export * from './rps/rps.engine';
export * from './bingo/bingo.engine';

/** Engines that are implemented and playable. */

export const ENGINES: Partial<Record<GameSlug, GameEngine<any, any>>> = {
  ludo: ludoEngine,
  poker: pokerGameEngine,
  blackjack: blackjackEngine,
  conquer: conquerEngine,
  crazy: crazyEngine,
  penalty: penaltyEngine,
  rps: rpsEngine,
  bingo: bingoEngine,
};

export function getEngine(slug: GameSlug): GameEngine<any, any> | null {
  return ENGINES[slug] ?? null;
}
