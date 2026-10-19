# Architecture

```
apps/web      Next.js 15 Telegram Mini App (React 19, Tailwind)  ──┐ REST + Socket.IO (JWT)
apps/bot      Telegraf bot (menu, rewards, referrals)  ── internal REST (x-internal-key)
apps/api      NestJS 10 · TypeORM · PostgreSQL · Redis · Socket.IO ◄┘
packages/engines   Pure TypeScript rule engines (Ludo, Poker, Blackjack)
packages/shared    Game catalog, view/action types, socket contract
```

## Game catalog
`packages/shared/src/catalog.ts` is the single source of truth: `ludo`, `poker`, `blackjack`, `conquer`. On boot the API's `GamesService.syncCatalog()` inserts missing games and **deletes any other row** from `games`, so legacy titles cannot reappear. A game without a registered engine is forced into maintenance.

## Rule engines
Each engine implements `GameEngine` (`packages/engines/src/core.ts`):

| Method | Purpose |
|---|---|
| `parseConfig(input, stake)` | Validate room options → typed config |
| `start(players, config, ctx)` | Initial state + ledger intents (stakes/buy-ins) |
| `act(state, playerId, action, ctx)` | Validate and apply one player action |
| `tick(state, ctx)` | Apply what is due when the deadline has passed (timeouts, next hand) |
| `view(state, viewerId)` | Personalised view with private information removed |
| `placements(state)` | Final ranking once finished |

Engines are pure: no I/O, state is plain JSON, randomness comes from `ctx.rng` (production: `crypto.randomInt`; tests: seeded). They never touch balances; they return **ledger intents** with keys unique within the match.

## Match runtime (`apps/api/src/matches/match-runtime.service.ts`)
Every transition — a player action or a timer tick — is one PostgreSQL transaction:

1. `SELECT … FOR UPDATE` on the `matches` row (serialises all instances); a per-match in-process queue avoids contention locally.
2. Duplicate check: `(matchId, userId, clientActionId)` already in `match_events` → acknowledged without re-applying.
3. Load the players' balances; run the engine.
4. Apply ledger intents via `LedgerService` (key `match:<id>:<intent key>`).
5. Append events (`match_events`, monotonically increasing `seq`) for audit and replay.
6. Save state, `version + 1`, and the next `deadline`.
7. If finished: write placements, outcomes and `pointsDelta` to `match_players`, upsert `player_stats`, close the room. Because this happens under the row lock and only while `status = 'active'`, results and statistics are written exactly once.

After commit the runtime re-arms the in-memory timer and publishes personalised views.

## Virtual-points ledger (`apps/api/src/wallet/ledger.service.ts`)
- The only code path that changes `users.balance`.
- `INSERT … ON CONFLICT (idempotencyKey) DO NOTHING` → a replayed key is a no-op.
- `UPDATE users SET balance = balance + $amount WHERE … AND balance + $amount >= 0`, backed by a `CHECK (balance >= 0)` constraint. If the update matches no row the whole transaction rolls back (`INSUFFICIENT_BALANCE`).
- Keys: `welcome:<user>`, `daily:<user>:<yyyy-mm-dd>`, `referral:<newUser>`, `match:<id>:…`, `admin:<uuid>`.
- Points are free, non-transferable, cannot be purchased and have no cash value. There is no wagering of money anywhere.

## Real-time contract
Socket.IO, authenticated during the handshake with the session JWT (middleware — no event is processed before the user is known).

| Client → server | Server → client |
|---|---|
| `room:subscribe {code}` (ack: room) | `room:state` |
| `match:subscribe {matchId}` — re-sends the latest view | `match:state` (personalised, versioned) |
| `match:action {matchId, clientActionId, action}` (ack) | `match:ended`, `balance:update` |

Channels: `user:<id>` (personal views and balance), `room:<code>`, `match:<id>:spectators` (public view). With `REDIS_URL` set, the `@socket.io/redis-adapter` fans events out across API instances. Redis also tracks presence and rate-limits actions (10/s per user).

## Privacy
- Internal state (decks, shoe, hole cards, dealer hole card) is stored only in `matches.state` and never serialised to clients.
- Views replace hidden cards with `"??"`. Integration tests assert that no socket payload received by one player contains another player's hole cards.
- Event replays are available only to participants and only after the match ends.

## Recovery
- All authoritative state is in PostgreSQL. On boot the runtime re-arms timers for every `active` match; a 5-second sweep also processes any match whose `deadline` has passed (covers missed timers and multi-instance deployments).
- Clients re-emit `match:subscribe` on every reconnect and receive the current view.
- An integration test restarts the API on the same database mid-match and continues playing.

## Authentication
- Mini App: `POST /api/auth/telegram {initData}` — HMAC-SHA256 verification per Telegram's spec (`secret = HMAC("WebAppData", botToken)`), `auth_date` freshness check, constant-time comparison. Returns a 7-day HS256 JWT.
- Bot → API: `/api/internal/*` with `x-internal-key` (constant-time compared).
- `ALLOW_DEV_AUTH` enables a name-only login for local development; it is forced off when `NODE_ENV=production`.
- Admins: Telegram ids listed in `ADMIN_TELEGRAM_IDS`.
