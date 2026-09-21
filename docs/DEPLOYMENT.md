# Deployment

Two independent deployables — that's the point of the split architecture.

```
Browser ──▶ static host (apps/web/dist)
   │
   └──────▶ container platform (apps/api, long-lived Bun process) ──▶ managed PostgreSQL
```

## 1. Database

Provision a managed PostgreSQL 16 instance and note its connection string.

## 2. API (container)

```bash
docker build -f apps/api/Dockerfile -t taskboard-api .     # build from the repo root
```

Environment variables (see `apps/api/.env.example`):

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (enables `Secure` + `SameSite=None` cookies) |
| `DATABASE_URL` | your managed Postgres URL |
| `JWT_SECRET` | ≥ 32 random characters (`openssl rand -base64 48`); rotating it logs everyone's access tokens out |
| `FRONTEND_ORIGIN` | the **exact** deployed SPA origin, e.g. `https://tasks.example.com` — **never a wildcard** |
| `MIGRATE_ON_START` | `true`, **or** run `bun run db:migrate` as the platform's release command |
| `TRUST_PROXY` | `true` only if your platform's proxy sets/overwrites `X-Forwarded-For` |

The API must be served over **HTTPS** (the refresh cookie is `Secure`). Health check: `GET /health`.

## 3. Web (static)

```bash
VITE_API_URL=https://api.example.com bun run --filter @taskboard/web build
# upload apps/web/dist to any static host
```

`VITE_API_URL` is baked in at build time. `public/_redirects` provides the SPA fallback for Netlify and Cloudflare Pages; on other hosts, configure "rewrite all paths to `/index.html`".

## Checklist

- [ ] `FRONTEND_ORIGIN` equals the SPA's origin exactly (scheme + host + port)
- [ ] API and database are reachable only over TLS
- [ ] Migrations applied
- [ ] Log in, close the browser completely, reopen: you're still signed in
- [ ] Log in from a second origin (e.g. a preview URL): the browser blocks it — expected
- [ ] `/health` returns `{"status":"ok"}`

> If the SPA and API share a registrable domain (e.g. `app.example.com` and `api.example.com`), `COOKIE_SAMESITE=Lax` is also valid and slightly stricter.
