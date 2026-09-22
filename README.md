# Task Board

A shared task board for a small team: register, create boards, invite teammates, and move tasks between **To do / In progress / Done** without a page reload.

This is **Project 2 — Task Management Application** from *Build 10 Real-World Projects*: the first project with a genuinely decoupled architecture (a React SPA and a separately deployed API) and the first with real multi-user authentication.

| | |
|---|---|
| **Frontend** | React 19 · Vite · TypeScript · React Router · TanStack Query · React Hook Form + Zod |
| **Backend** | Hono on Bun · TypeScript · Zod |
| **Database** | PostgreSQL 16 · Drizzle ORM · SQL migrations |
| **Auth** | bcrypt · short-lived JWT access token (in memory) · rotating refresh token (httpOnly cookie) |
| **Tests** | `bun test` against a real Postgres · Vitest + React Testing Library with a mocked fetch layer |

```
   React SPA (Vite build)            Hono API on Bun               PostgreSQL
  ┌────────────────────┐   REST    ┌──────────────────┐   SQL   ┌────────────┐
  │ apps/web           │ ────────▶ │ apps/api         │ ──────▶ │ users      │
  │ static files       │ Bearer    │ CORS · rate limit│         │ boards     │
  │ any static host    │ <JWT>     │ Zod · Drizzle    │         │ board_members
  └────────────────────┘           └──────────────────┘         │ tasks      │
   holds the access token            holds the refresh token     │ refresh_tokens
   in memory only                    hash + all business rules   └────────────┘
```

The frontend has **zero server code**: every piece of data crosses a defined REST contract, and the API re-validates everything regardless of what the client already checked.

## Features

Requirements → where they live:

- **Multiple registered users with secure login** — bcrypt-hashed passwords, JWT + refresh-cookie sessions, per-IP login rate limiting.
- **Boards and tasks with a status** — three-lane board; status changes via a real labeled `<select>` (optimistic, rolls back on failure).
- **Assign a task to a teammate** — assignee must be a board member (enforced server-side).
- **Edit, delete, due dates** — inline edit form; overdue tasks are flagged with text as well as colour.
- **Filter by assignee or status** — server-side query params (`?assignee=me&status=done`), plus due-date sorting.
- **Everything persists in Postgres with real migrations** — `apps/api/drizzle/*.sql`, applied by `bun run db:migrate`.
- **Stay logged in across a browser restart** — on load the SPA trades the httpOnly refresh cookie for a fresh access token.
- **Teammates see the same board** — the board refreshes every 10 s (and on window focus).

## Quick start

Prerequisites: [Bun](https://bun.sh) 1.x, [Docker](https://docs.docker.com/get-docker/), Node.js 22+ (Vite/Vitest run on it).

```bash
# 1. Start Postgres (dev database on :5432, disposable test database on :5433)
bun run db:up

# 2. Configure the API
cp apps/api/.env.example apps/api/.env
#    then set JWT_SECRET to a long random string:  openssl rand -base64 48
cp apps/web/.env.example apps/web/.env      # optional; default API URL is http://localhost:3000

# 3. Install and migrate
bun install
bun run db:migrate

# 4. Run both apps
bun run dev          # API → http://localhost:3000   Web → http://localhost:5173
```

Open http://localhost:5173, register two accounts (use a private window for the second), create a board with the first, add the second by email, and watch both see the same tasks.

> The web app **must** run on `http://localhost:5173` in development: that exact origin is what the API's CORS allow-list expects (`FRONTEND_ORIGIN`).

### Scripts

| Command | What it does |
|---|---|
| `bun run dev` | API (watch mode) and web dev server together |
| `bun run test` | Both test suites (needs the `db-test` container up) |
| `bun run typecheck` | `tsc --noEmit` in both apps |
| `bun run build` | Typecheck + Vite production build of the SPA |
| `bun run db:up` / `db:down` | Start / stop the Postgres containers |
| `bun run db:generate` | Generate a new SQL migration after editing `apps/api/src/db/schema.ts` |
| `bun run db:migrate` | Apply pending migrations |
| `bun run --filter @taskboard/api demo:n-plus-one` | Measure the N+1 query cost (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |

## Project structure

```
apps/
  api/                      Hono API (runs directly on Bun — no build step)
    drizzle/                SQL migrations (committed)
    scripts/n-plus-one.ts   Runnable N+1 demonstration
    src/
      app.ts                middleware, CORS, global error handler
      config.ts             validated environment (fails fast with a clear message)
      db/                   schema.ts · client.ts · migrate.ts
      lib/                  tokens · password · validation (Zod) · board access · task queries
      middleware/           auth (JWT) · rateLimit · origin check · client IP
      routes/               auth · boards · tasks
    test/                   bun tests — real Postgres, no mocks
  web/                      React SPA
    src/
      lib/                  api.ts (the one fetch wrapper) · queries.ts · schemas.ts · format.ts
      auth/                 AuthContext (session restore, login, logout)
      components/           Toast · TaskCard · TaskForm · FilterBar · MembersPanel · …
      pages/                Login · Register · Boards · Board
docs/                       API reference, security, debugging, performance, deployment
```

## How authentication works

1. **Register / log in** → the API returns `{ user, accessToken }` in the body and sets `refresh_token` as an **httpOnly, Path=/auth** cookie.
2. The SPA keeps the access token (15 min JWT) **in a JavaScript variable only** — never `localStorage` — and sends it as `Authorization: Bearer …`.
3. **The token expires mid-session?** The API answers `401 TOKEN_EXPIRED`. The fetch wrapper makes *one* `POST /auth/refresh` (shared by every concurrent request), then retries the original request. The user sees nothing.
4. **Refresh tokens rotate**: each use revokes the old token and issues a new one. Tokens are stored **hashed (SHA-256)**; a replayed token is rejected.
5. **Page reload / browser restart** → the SPA calls `/auth/refresh` on boot and restores the session from the cookie.
6. If the refresh fails, the user is returned to the login page with a single toast.

## Every write endpoint follows the same order

```
authenticate  →  look up the resource  →  check the caller may touch it  →  apply the change
 (401)             (404)                    (403)
```

See `apps/api/src/routes/tasks.ts`. Auth is applied at the *router* level, so a new route can't ship without it.

## Testing

```bash
bun run db:up            # starts the disposable `db-test` container (tmpfs, fsync off)
bun run test
```

- **API (85 tests)** — the test that mattered most, per the book: requests run against a **real disposable Postgres**, not a mock. Covers auth (bcrypt, rotation, one-winner concurrent refresh, expired vs invalid tokens), authorization (non-members get 403 on every endpoint), filtering/sorting, mass-assignment protection, concurrent edits, CORS, the rate limiter, database-level CHECK constraints, structured logging, graceful shutdown, and refusing to boot in production with an insecure config — including two tests that spawn the real `bun src/index.ts` process. The suite **refuses to run** against any database whose name doesn't end in `_test`, because it truncates tables.
- **Web (36 tests)** — Vitest + React Testing Library with a mocked `fetch`: the status-change interaction (optimistic move + rollback + toast), refresh-and-retry, single-flight refresh, instant form validation, filters, session restore, and accessibility-relevant queries (labeled selects, `role="alert"` toasts).

**CI:** [`docs/ci-workflow.yml`](docs/ci-workflow.yml) runs both suites on every pull request against a Postgres service container. To enable it, move it to `.github/workflows/ci.yml` (GitHub only accepts that path from a credential with the `workflow` permission, which the first push didn't have).

## Deployment

The API deploys to any container platform that keeps a long-lived Bun process running (`apps/api/Dockerfile`); the SPA is static files for any static host. **Production CORS is locked to the exact frontend origin — never a wildcard.** Details and a checklist: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Where this differs from the book's abbreviated code

The chapter shows trimmed snippets; making the described behaviour actually work required a few additions:

| Addition | Why |
|---|---|
| `board_members` table (with `owner` / `member` role) | "Teammates can see and edit it too" and the book's `requireBoardMember()` need to know *who belongs to a board*; `boards.owner_id` alone can't express that. |
| `refresh_tokens` table | The book specifies a refresh token in an httpOnly cookie; storing hashes enables rotation and logout revocation. |
| `users.name` | The performance section loads "each assignee's **name**". |
| `NOT NULL` + `ON DELETE` rules on foreign keys, `created_at` / `updated_at` | Relational integrity is the stated reason for choosing Postgres. |
| Zod 4, Vitest 5, Vite 8, TypeScript 7 | Current major versions at build time; the book's snippets are version-agnostic on these. |

## Advanced challenges

| | Status |
|---|---|
| Exercise: board-level roles (owner can delete the board, members cannot) | ✅ Done — owners also manage the member list |
| Exercise: due-date sorting and an "overdue" indicator | ✅ Done |
| Challenge: drag-and-drop with `@dnd-kit` + keyboard fallback | ⬜ Not implemented — deliberately deferred by the book |
| Challenge: live updates instead of polling | ⬜ Not implemented — preview of Project 4 (the board polls every 10 s) |

## Docs

- [API reference](docs/API.md)
- [Security notes](docs/SECURITY.md) — CORS, cookies, rate limiting, what's deliberately not covered
- [Debugging: the mid-session 401](docs/DEBUGGING.md)
- [Performance: the N+1 query](docs/PERFORMANCE.md)
- [Deployment](docs/DEPLOYMENT.md)
