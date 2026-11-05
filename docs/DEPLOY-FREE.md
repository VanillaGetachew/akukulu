# Free hosting: Neon + Render + Vercel

| Piece | Where | Why |
| --- | --- | --- |
| Postgres | Neon (free) | Render's free Postgres is deleted after 30 days; Neon's free database does not expire. |
| API + Telegram bot | One Render free web service (`docker/render.Dockerfile`) | Render Free has no background workers, so the bot runs inside the API container. |
| Web app (Mini App) | Vercel Hobby | Never sleeps, so the Mini App opens instantly. |
| Redis | not needed | Leave `REDIS_URL` empty while there is a single API instance. |

## 1. Database (Neon)
1. Create a project at neon.com (pick the region closest to your players, e.g. Frankfurt).
2. Copy the connection string (the "pooled" one is fine). It ends in `?sslmode=require`; keep that.

## 2. API + bot (Render)
1. Push the repo to GitHub.
2. Render → New → Web Service → connect the repo.
   - Language: Docker. Dockerfile path: `docker/render.Dockerfile`. Docker context: `.` (repo root).
   - Instance type: Free. Health check path: `/api/health`.
3. Environment variables:
   ```
   NODE_ENV=production
   DATABASE_URL=<Neon connection string>
   DB_SYNCHRONIZE=true            # creates the tables; the app has no migrations yet
   JWT_SECRET=<48+ random characters>
   INTERNAL_API_KEY=<another random string>
   TELEGRAM_BOT_TOKEN=<from @BotFather>
   TELEGRAM_BOT_USERNAME=<bot username without @>
   TELEGRAM_WEBAPP_LINK=https://t.me/<bot>/<app short name>
   WEBAPP_URL=https://<your-vercel-app>.vercel.app
   CORS_ORIGINS=https://<your-vercel-app>.vercel.app
   ADMIN_TELEGRAM_IDS=<your Telegram user id>
   REWARDS_REQUIRE_APPROVAL=true
   COMMUNITY_URL=https://t.me/<community>
   SUPPORT_URL=https://t.me/<support>
   ```
   Do not set `PORT` (Render sets it) or `REDIS_URL`.
4. Deploy. Check `https://<service>.onrender.com/api/health`.

### Keep it awake
Free services sleep after 15 minutes without inbound traffic, which would also stop the bot and the game timers.
Create a free job at cron-job.org that requests `https://<service>.onrender.com/api/health` every 10 minutes.
One service awake all month uses about 744 of the 750 free hours, so keep only this one service on Render Free.

## 3. Web app (Vercel)
1. Vercel → Add New → Project → import the repo. Root directory: `apps/web` (enable "Include files outside the root directory").
   `apps/web/vercel.json` already sets the install and build commands for the monorepo.
2. Environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://<service>.onrender.com
   NEXT_PUBLIC_DEV_AUTH=false
   ```
3. Deploy, then put the Vercel URL into Render's `WEBAPP_URL` and `CORS_ORIGINS` and redeploy Render.

## 4. Telegram
In @BotFather: `/mybots` → your bot → Bot Settings → Configure Mini App / Menu Button → URL = the Vercel URL.
`/newapp` (or Edit App) → Web App URL = the Vercel URL; use that `t.me/<bot>/<app>` link as `TELEGRAM_WEBAPP_LINK`.

## Manual Telebirr payments (off by default)
With `PAYMENTS_ENABLED=true` the bot gets Deposit and Withdraw buttons, balances show as ETB, and new welcome, daily and referral rewards stop.

**One number at a time.** On the bot's Deposit screen an admin sees `✏️ Change number` (the web admin page has the same form). Whoever changes it gets the requests from then on, as a pop-up in the web app and a Telegram message. Other admins can see everything with `/pending`, and nobody can decide their own request. Admins are the people in `ADMIN_TELEGRAM_IDS`, and they must press Start in the bot.

- **Deposit:** the player types the amount and is shown the current number and name, with a copy button. They send the money, then enter the Telebirr transaction ID. Nothing is credited until an admin checks Telebirr and approves.
- **Withdraw:** the player enters the amount and their number. The amount leaves their balance straight away. Approve after sending the money; Reject returns it.

**Rooms** have a one-minute countdown instead of a ready button. They start when it ends if enough players joined, or at once when full; otherwise they close. Nobody pays until a room starts.

**Promotions** are set in `PROMOTIONS` in `packages/shared/src/catalog.ts`. **Automatic tournaments** are set in `POKER_AUTO_TOURNAMENTS` in `packages/shared/src/games/poker.ts`.

**House fees** are set in `packages/shared/src/house.ts` and recorded in `house_earnings`; the admin page shows the total.

## Limits to know
- Render Free can restart the service at any time; active matches are recovered from the database on boot.
- Neon Free gives 100 compute-hours a month per project; a database that is queried around the clock can run past it. Watch Usage in the Neon console.
- Vercel Hobby is for non-commercial projects.
- When you outgrow this, move the API to Render Starter (or any paid host) and set `DB_SYNCHRONIZE=false` once you add migrations.

## Memory (Render Free: 512 MB)
The container runs only two Node processes, the API and the bot, straight from compiled JavaScript (no `npm`, no TypeScript, no Next.js at runtime; the web app is on Vercel).
Expect roughly 120–200 MB for the API and 50–80 MB for the bot when idle, growing a few tens of KB per connected player.
`render-start.sh` caps the heaps (API 256 MB, bot 96 MB) so a leak restarts the service instead of the host killing it; change them with `API_HEAP_MB` / `BOT_HEAP_MB`.
Watch Render → Metrics → Memory after launch. If it sits above ~400 MB, move the bot to its own service or upgrade the plan.
