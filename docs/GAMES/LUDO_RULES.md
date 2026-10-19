# Ludo — implemented rules

Engine: `packages/engines/src/ludo/ludo.engine.ts` · Tests: `ludo.engine.test.ts`

## Players and setup
- 2–4 players, four tokens each. Colours by player count:
  - 2 players: red, yellow (opposite corners)
  - 3 players: red, green, yellow
  - 4 players: red, green, yellow, blue
- Seats are taken in join order; the **first player is chosen by the server's secure RNG**. Play proceeds clockwise in seat order.
- All tokens start in the yard.

## Board model
- A shared track of 52 squares. Each colour's start square is at absolute index red 0, green 13, yellow 26, blue 39.
- Token position is stored as *progress* relative to its own start square:
  `-1` yard · `0–50` shared track · `51–55` private home column · `56` home.
- **Safe squares** (no capture possible): the four start squares (0, 13, 26, 39) and the four star squares (8, 21, 34, 47).

## Turn
1. The current player rolls one die (1–6). **Dice values come only from the server** (`crypto.randomInt`); any value a client sends is ignored.
2. Legal moves:
   - A token in the yard may enter only on a **6**, onto its start square.
   - A token on the board moves forward exactly the rolled number.
   - **Exact finish**: a move that would go past home (progress 56) is illegal.
3. If no move is legal the turn passes (but see the 6 rule below).
4. If exactly one distinct move exists it is made automatically (configurable: `autoMoveSingle`). Moving any of several identical yard tokens counts as one move.

## Captures
- Landing on a non-safe shared-track square occupied by opponent token(s) sends **all** of those tokens back to their yard.
- Tokens of the same colour may share a square. No blockades are formed (opponents can pass and land on stacked tokens).
- Tokens in home columns can never be captured.

## Extra turns
The player rolls again after:
- rolling a **6** (even when no move was possible),
- **capturing** (configurable `extraTurnOnCapture`, default on),
- bringing a token **home** (configurable `extraTurnOnHome`, default on).

**Three consecutive 6s** in one turn forfeit the rest of the turn; the third 6 is not played.

## Winning and ending
- The first player with all four tokens home wins and the match ends immediately.
- Placements: winner 1st; remaining active players ranked by total progress; forfeited players last (most recent forfeit ranks higher).
- If all opponents leave or forfeit, the last active player wins.

## Timeouts, disconnection, leaving
- Each turn has a server-side deadline (`turnSeconds`, default 20 s).
- On timeout the server plays for the player: it rolls, and moves the most advanced legal token. This counts as a missed turn.
- After `maxMissedTurns` (default 3) consecutive missed turns the player forfeits. Acting manually resets the counter.
- Leaving (`{ type: 'leave' }`) forfeits immediately. Forfeited tokens are removed from the board.
- Disconnected players are simply subject to the timer; on reconnect the client re-subscribes and receives the current state.

## Points
- Optional entry stake (room `stake`, default 0). Each player's stake is debited when the match starts; the winner is credited the whole pot exactly once (ledger key `match:<id>:payout:<player>`).

## Actions
`{ type: 'roll' }` · `{ type: 'move', token: 0–3 }` · `{ type: 'leave' }`
