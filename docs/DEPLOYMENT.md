# Deployment and recovery

## 1. Telegram setup
1. Create a bot with [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`.
2. Host the web app on a public **HTTPS** URL (Telegram requires HTTPS) → `WEBAPP_URL`.
3. In BotFather: `/newapp` (or *Bot Settings → Configure Mini App*) pointing at that URL. The resulting direct link (e.g. `https://t.me/akukulu_bot/play`) → `TELEGRAM_WEBAPP_LINK`; room invites use `?startapp=room_<CODE>`.
4. The bot sets its menu button to the Mini App on start.
5. Branding (files in `apps/web/public/brand/`):
   - Bot profile picture: BotFather `/setuserpic` → `akukulu-avatar-640.png`.
   - Mini App photo (640×360): BotFather `/editapp` → *Edit photo* → `akukulu-miniapp-640x360.png`.
   - `akukulu-emblem.svg` / `akukulu-emblem-512.png` (full emblem, transparent) and `akukulu-mark.svg` (compact shield for small sizes) for anything else.

## 2. Configuration
Copy `.env.example` to `.env` and set at least:

| Variable | Notes |
|---|---|
| `NODE_ENV=production` | Disables dev login regardless of `ALLOW_DEV_AUTH`. |
| `JWT_SECRET` | ≥ 32 random characters. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBAPP_LINK` | From BotFather. |
| `INTERNAL_API_KEY` | Random secret shared by API and bot. |
| `ADMIN_TELEGRAM_IDS` | Comma-separated Telegram user ids. |
| `CORS_ORIGINS` | The web app origin(s). |
| `NEXT_PUBLIC_API_URL` | Leave empty: the web app proxies `/api` and `/socket.io` to the API (`INTERNAL_API_ORIGIN`), so one domain or tunnel serves both. |
| `REWARDS_REQUIRE_APPROVAL` | `true` (default): daily and referral rewards wait in *Admin → Rewards waiting for approval*. |
| `WEBAPP_URL` | Public web URL used by the bot. |
| `DB_SYNCHRONIZE` | See *Schema* below. |

## 3. Run with Docker Compose
```bash
docker compose up -d --build              # postgres, redis, api, web
docker compose --profile bot up -d bot    # Telegram bot (needs a real token)
```
Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of `web:3000` and `api:4000`. The proxy must allow WebSocket upgrades on `/socket.io/`.

Host ports are configurable with `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` if 5432/6379 are taken.

## 4. Schema
The current release creates/updates tables with TypeORM `synchronize` (`DB_SYNCHRONIZE=true`, the default outside production). For production:
1. Run once with `DB_SYNCHRONIZE=true` against an empty database to create the schema, then set it to `false`.
2. Before upgrading, review entity changes in `apps/api/src/database/entities.ts`, back up, and apply them deliberately (generating TypeORM migrations is a listed follow-up).

## 5. Scaling
- The API is stateless apart from in-memory timers. Run several instances behind a load balancer with `REDIS_URL` set so Socket.IO events reach every client. Match transitions are serialised by PostgreSQL row locks, and the deadline sweep makes timers safe on any instance.
- Socket.IO connections should use sticky sessions if the polling transport is enabled; the web client prefers WebSocket.

## 6. Backups
- PostgreSQL holds everything that matters: users, balances, ledger, matches, events, stats. Back up with `pg_dump` on a schedule and test restores.
- Redis holds only presence, rate-limit counters and pub/sub; it can be lost safely.

## 7. Recovery procedures
| Situation | What happens / what to do |
|---|---|
| API restart or crash | Active matches are reloaded from PostgreSQL; timers are re-armed at boot and by the 5 s sweep. Clients reconnect automatically and re-subscribe. No action needed. |
| Redis outage | Real-time fan-out across instances and presence degrade; matches remain consistent. Restart Redis. |
| Stuck or disputed match | Admin → *Active matches* → **Void**. Each player's unreturned stake is refunded (idempotent keys `match:<id>:void:<user>`). |
| Wrong balance | Admin → *Users* → **Adjust** (always recorded in the ledger with a reason). |
| Audit | `ledger_entries` (every point movement with its idempotency key) and `match_events` (ordered event log per match). |

## 8. Health
`GET /api/health` returns database reachability and the online-player count; the API container has a Docker `HEALTHCHECK` on it.
