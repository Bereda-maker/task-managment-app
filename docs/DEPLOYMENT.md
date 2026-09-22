# Deployment: step by step

Two independent deployables, plus a database:

```
Browser ──▶ static host (apps/web/dist)
   │
   └──────▶ container platform (apps/api, long-lived Bun process) ──▶ managed PostgreSQL
```

This walkthrough uses **Railway** for the API + database and **Netlify** for the SPA, because both let you go from "empty account" to "live URL" without touching infrastructure. Any container platform (Render, Fly.io, a VM with Docker) and any static host (Vercel, Cloudflare Pages, S3+CloudFront) work the same way — the environment variables and checklist below are what actually matter.

## 0. Before you start

Generate a real JWT secret now; you'll paste it into the platform in step 2:

```bash
openssl rand -base64 48
```

Never reuse the value in `apps/api/.env.example` — the app **refuses to boot in production** if `JWT_SECRET` looks like a placeholder (see `apps/api/src/config.ts`).

## 1. Database

1. Railway → **New Project → Provision PostgreSQL**.
2. Open the Postgres service → **Variables** tab → copy `DATABASE_URL`. You'll paste it into the API service in the next step.

(Any managed Postgres 16 works — RDS, Supabase, Neon, Fly Postgres. You just need the connection string.)

## 2. API

1. In the same Railway project: **New → GitHub Repo** → pick this repo.
2. Railway will try to auto-detect a build; override it so it builds and runs *only* the API:
   - **Root Directory:** `apps/api`
   - **Build Command:** *(leave blank — the API runs directly on Bun, no build step)*
   - **Start Command:** `bun src/index.ts`
   - **Watch Paths:** `apps/api/**` (so a web-only commit doesn't redeploy the API)
3. **Variables** tab — add these (see `apps/api/.env.example` for the full list with comments):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | paste from step 1 |
   | `JWT_SECRET` | the value from step 0 |
   | `FRONTEND_ORIGIN` | *(placeholder for now — you'll fill this in after step 3)* `https://REPLACE-ME.netlify.app` |
   | `MIGRATE_ON_START` | `true` |

   Everything else has a safe default (rate limits, pool size, log level — see the `.env.example` comments). Leave `PORT` unset; Railway injects it automatically and the app reads `process.env.PORT`.
4. Deploy. Watch the build log for:
   ```
   {"time":"...","level":"info","msg":"migrations applied"}
   {"time":"...","level":"info","msg":"api listening","port":...}
   ```
   If it exits immediately instead with `JWT_SECRET looks like a placeholder` or `FRONTEND_ORIGIN must be set in production`, fix that variable and redeploy — this is the config validation in `apps/api/src/config.ts` doing its job.
5. Railway → **Settings → Networking → Generate Domain**. Copy the resulting URL (e.g. `https://taskboard-api-production.up.railway.app`) — you need it for step 3.
6. Sanity check:
   ```bash
   curl https://<your-api-domain>/health   # -> {"status":"ok","uptimeSeconds":...}
   curl https://<your-api-domain>/ready    # -> {"status":"ready"}
   ```

## 3. Web (static)

1. Netlify → **Add new site → Import an existing project** → this repo.
2. Build settings:
   - **Base directory:** `apps/web`
   - **Build command:** `bun run build` (or `npm run build` if the Netlify build image doesn't have Bun — Vite's build itself needs only Node)
   - **Publish directory:** `apps/web/dist`
3. **Environment variables** → add `VITE_API_URL` = the API domain from step 2.5 (e.g. `https://taskboard-api-production.up.railway.app`, **no trailing slash**). This is baked into the bundle at build time.
4. Deploy. Netlify gives you a URL like `https://taskboard-abc123.netlify.app`. `public/_redirects` (already in the repo) makes client-side routing work on refresh.

## 4. Connect the two

Go back to Railway → the API's `FRONTEND_ORIGIN` variable → replace the placeholder with the **exact** Netlify URL from step 3 (scheme + host, no path, no trailing slash) → redeploy the API.

This is the step people skip and then can't figure out why login "does nothing": until `FRONTEND_ORIGIN` matches, the browser blocks every request with a CORS error (see `docs/SECURITY.md`).

## 5. Verify the live deployment

- [ ] Open the Netlify URL, register an account, create a board, add a task.
- [ ] Open DevTools → Application → Cookies: `refresh_token` is present, `HttpOnly` ✓, `Secure` ✓, `SameSite=None`.
- [ ] Close the browser completely and reopen the URL — you're still logged in (refresh-cookie flow).
- [ ] Open the same URL in an incognito window: fully independent session — no CORS errors in the console.
- [ ] `curl https://<api-domain>/health` and `/ready` both return 200.
- [ ] In Railway's logs, requests appear as single-line JSON (`{"time":...,"level":"info","msg":"request",...}`), and nothing in the logs contains a password or token.

If something's wrong, `docs/DEBUGGING.md` and `docs/SECURITY.md` cover the two most common failure modes (CORS misconfiguration, and the mid-session token refresh).

## Redeploying after changes

Both platforms redeploy automatically on push to `main` (Railway watches `apps/api/**`, Netlify watches `apps/web/**` by default — configure "base directory" restricts triggers similarly). New database migrations apply automatically on the API's next boot because `MIGRATE_ON_START=true`; the migration runner takes an advisory lock, so it's safe even if Railway briefly runs two instances during a deploy (see `apps/api/src/db/migrate.ts`).

To apply a migration **without** restarting the API (e.g. ahead of a deploy), run it from your machine against the production database:

```bash
DATABASE_URL="<production connection string>" bun run --filter @taskboard/api db:migrate
```

## Reference: every environment variable

See `apps/api/.env.example` — it's the source of truth, with inline comments. Highlights for production:

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` — enables `Secure` + `SameSite=None` cookies and JSON logs |
| `JWT_SECRET` | ≥ 32 random characters, not a placeholder (validated at boot) |
| `FRONTEND_ORIGIN` | required in production; must be `https://` (or `http://localhost` for local testing in prod mode); exact origin, no path |
| `DATABASE_URL` | your managed Postgres connection string |
| `TRUST_PROXY` | `true` **only** if your platform's proxy sets/overwrites `X-Forwarded-For` — otherwise clients could spoof their IP and dodge rate limiting |
| `LOG_LEVEL` | `info` in production; set to `debug` temporarily while investigating an issue |

## Alternative: Docker on any VM / container platform

```bash
docker build -f apps/api/Dockerfile -t taskboard-api .   # from the repo root
docker run -p 3000:3000 --env-file apps/api/.env taskboard-api
```

The image includes a `HEALTHCHECK` (`GET /health`) that most orchestrators (Docker Compose, ECS, Nomad) pick up automatically. On Kubernetes, wire `GET /health` as the **liveness** probe and `GET /ready` as the **readiness** probe — that split is exactly why the two endpoints exist (see `docs/API.md`).

## Rollback

Both Railway and Netlify keep previous deploys and offer a one-click rollback in their dashboard. Because migrations are additive (this project has never shipped a destructive migration), rolling back the API to an older image is safe even if a newer migration already ran — the old code simply doesn't use the new column/table yet. Rolling back *past* a migration that removed a column the old code needs would not be safe; this project hasn't needed that yet, but if you add one, ship it as two deploys (stop using the column, then drop it).
