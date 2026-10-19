# Conquer — ruleset pending

**Status: not implemented.** Conquer appears in the catalog with slug `conquer`, but it has no rules engine yet.

- The game is seeded in **maintenance** mode with the message "Conquer is coming soon — the official ruleset is being finalized."
- The API refuses to create rooms for it (`503 GAME_MAINTENANCE`), and administrators cannot lift maintenance while no engine is registered (`NO_ENGINE`).
- The lobby shows the card with a "Coming soon" badge; opening it shows the maintenance state.

The project owner is supplying an authoritative Ethiopian Conquer specification that replaces the earlier Conquian-style draft (40-card deck, 41-point opening). This document will be rewritten with the implemented rules — player count, hand size, deck and rank order, card values, opening requirement, draw restrictions, meld and lay-off rules, final discard, stock exhaustion, scoring, dealer progression, and timeout behaviour — when the engine is built.

## Integration checklist for the engine
1. Add view/action/config types in `packages/shared/src/games/conquer.ts` and export them.
2. Implement `GameEngine` in `packages/engines/src/conquer/` (pure, deterministic given an `Rng`; private hands and stock order only in internal state; `view()` must hide them).
3. Register it in `ENGINES` (`packages/engines/src/index.ts`) — the catalog sync then allows maintenance to be lifted.
4. Add a table component in `apps/web/src/components/games/` and route it in `apps/web/src/app/room/[code]/page.tsx`.
5. Tests: unit tests per rule, complete simulated matches, privacy checks, and an API integration test.
