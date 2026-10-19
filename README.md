# አኩኩሉ | Akukulu

A Telegram Mini App gaming platform with exactly four games — **Ludo, Poker, Blackjack and Conquer** — played with free, non-redeemable virtual points.

> Points are free in-game credits. They cannot be purchased, transferred between users, or exchanged for money. There is no cash wagering.

## Status

| Area | State |
|---|---|
| Game catalog (`ludo`, `poker`, `blackjack`, `conquer`) | ✅ Single source in `packages/shared`; API prunes any other game on boot |
| Ludo | ✅ Engine, real-time UI, server dice, timers, settlement — [rules](docs/GAMES/LUDO_RULES.md) |
| Poker (NL Texas Hold'em) | ✅ Engine, hand evaluator, side pots, UI, private cards — [rules](docs/GAMES/POKER_RULES.md) |
| Blackjack | ✅ Engine, S17 / 3:2, double, split, UI, hidden hole card — [rules](docs/GAMES/BLACKJACK_RULES.md) |
| Conquer (Ethiopian, 1v1) | ✅ **Playable beta** — 52 cards, 14-card hands, Up/Down/Side/Up & Down wildcards, 41-point opening, swaps, exhaustion scoring, rematches. Several house rules await confirmation — [rules](docs/GAMES/CONQUER_RULES.md#rules-awaiting-confirmation) |
| Telegram auth (initData HMAC on the backend) | ✅ |
| Rooms: public/private, codes, invites, ready-up, quick play | ✅ |
| Socket.IO real-time, server-authoritative state, reconnection | ✅ |
| Restart recovery from PostgreSQL | ✅ (tested) |
| Idempotent, non-negative virtual-points ledger | ✅ |
| Profiles, match history, leaderboards, daily reward, referrals | ✅ |
| Admin: overview, game toggles, users (ban/adjust), void matches | ✅ |
| Telegram bot menu | ✅ (not exercised against live Telegram in this environment) |
| Docker Compose | ✅ |

### Known limitations
- Conquer's wildcard prediction mapping and several wildcard/ending rules are documented defaults that still need confirmation against authoritative Ethiopian rules; the game is marked **Beta**. Only the 1v1 mode exists.
- Schema is managed with TypeORM `synchronize`; generated migrations are a follow-up ([deployment notes](docs/DEPLOYMENT.md#4-schema)).
- Blackjack is single-seat (one player per dealer).
- Poker blinds are fixed for the whole table; no rebuys; showdown hands are always revealed (no mucking).
- No automated browser end-to-end tests; the web UI was verified manually in a browser. Gameplay end-to-end is covered by API + Socket.IO integration tests.
- The bot was type-checked and built but not run against the Telegram API here.
- `npm audit` reports high-severity advisories that need major upgrades: NestJS 10 → 11/12 (`@nestjs/platform-express` pulls a vulnerable `multer`; the API exposes no upload endpoints) and Next.js 15 → 16 (bundled PostCSS, build-time). Plan these upgrades before a public launch.
- Online presence counts can include stale entries after an API crash (Redis presence is not expired per socket).

## Repository layout
```
apps/api          NestJS API: auth, rooms, match runtime, ledger, admin, Socket.IO gateway
apps/web          Next.js Mini App: lobby, game lobbies, rooms, Ludo/Poker/Blackjack tables
apps/bot          Telegraf bot: Play Games, Profile, Balance, Transactions, Rewards, Refer & Earn, Community, Support
packages/engines  Pure rule engines + tests
packages/shared   Catalog, types, socket contract
docs/             Architecture, deployment/recovery, game rules
```
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how state, settlement and privacy work.

## Local development
Requirements: Node ≥ 20 (22 recommended), Docker.

```bash
npm install
cp .env.example .env          # set ALLOW_DEV_AUTH=true for browser testing without Telegram
docker compose up -d postgres redis
npm run build:packages
npm run dev:api               # http://localhost:4000/api
npm run dev:web               # http://localhost:3000
```
For the web app create `apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_DEV_AUTH=true
```
With dev auth you sign in with any test name. To play against yourself, open a second browser profile (or `http://127.0.0.1:3000` — a different origin keeps a separate session; add it to `CORS_ORIGINS`).

## Tests
```bash
npm test                       # engine unit tests (+ API unit tests; integration tests skip without a DB)
npm run test:integration       # API + Socket.IO integration tests against PostgreSQL (database akukulu_test)
```
`test:integration` uses `TEST_DATABASE_URL`, defaulting to `postgres://akukulu:akukulu@127.0.0.1:${POSTGRES_HOST_PORT:-5432}/akukulu_test` (created by `docker/postgres-init.sql` on first start of the compose Postgres).

The integration suite covers: catalog pruning (and lifting Conquer's old maintenance flag), Telegram signature verification, welcome/referral/daily rewards (including concurrent claims), negative-balance protection, a complete two-player Ludo match over Socket.IO with duplicate-action and out-of-turn checks and exactly-once payout, poker card privacy and cash-out, a blackjack session with a hidden hole card, a full 1v1 Conquer round (private hands, simultaneous and duplicate actions, settlement, illegal actions) and a Conquer restore after restart, affordability checks, and recovery of an active match after an API restart.

## Production build
```bash
npm run build                  # all packages and apps
docker compose up -d --build   # see docs/DEPLOYMENT.md
```
