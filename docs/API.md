# API reference

Base URL in development: `http://localhost:3000`. All bodies are JSON.

**Errors** always look like `{ "error": "<human message>", "code": "<MACHINE_CODE>" }` (validation errors add `details: [{ path, message }]`).

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `ASSIGNEE_NOT_MEMBER` |
| 401 | `UNAUTHORIZED` (no token), `TOKEN_EXPIRED` (refresh and retry), `INVALID_TOKEN`, `INVALID_CREDENTIALS`, `NO_SESSION`, `INVALID_REFRESH_TOKEN` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND`, `USER_NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `ALREADY_MEMBER`, `OWNER_CANNOT_LEAVE`, `TASK_LIMIT_REACHED` |
| 413 | `PAYLOAD_TOO_LARGE` (> 100 KB) |
| 429 | `RATE_LIMITED` (with `Retry-After`) |
| 500 | `INTERNAL_ERROR` |

Protected endpoints need `Authorization: Bearer <accessToken>`.

## Auth

| Method & path | Body | Success |
|---|---|---|
| `POST /auth/register` | `{ name, email, password }` (password 8–72 bytes) | `201 { user, accessToken }` + refresh cookie |
| `POST /auth/login` (rate limited per IP) | `{ email, password }` | `200 { user, accessToken }` + refresh cookie |
| `POST /auth/refresh` (cookie) | — | `200 { user, accessToken }` + **rotated** refresh cookie |
| `POST /auth/logout` (cookie) | — | `204`, token revoked, cookie cleared |
| `GET /auth/me` 🔒 | — | `200 { user }` |

`/auth/refresh` and `/auth/logout` also reject a browser `Origin` other than the configured frontend.

## Boards 🔒

| Method & path | Notes |
|---|---|
| `GET /boards` | Boards you belong to, with `role` and `memberCount` |
| `POST /boards` `{ name }` | You become the owner |
| `GET /boards/:id` | Board plus `members` (members only) |
| `DELETE /boards/:id` | **Owner only**; cascades to tasks and memberships |
| `POST /boards/:id/members` `{ email }` | **Owner only**; the person must already be registered |
| `DELETE /boards/:id/members/:userId` | Owner removes anyone; a member may remove themselves; their tasks become unassigned; the owner can't leave |

## Tasks 🔒

| Method & path | Notes |
|---|---|
| `GET /boards/:id/tasks?status=&assignee=&sort=` | `status`: `todo` \| `in_progress` \| `done`. `assignee`: `me` \| `unassigned` \| a user id. `sort`: `created` (default) \| `dueDate` (undated last). Each task includes `assignee: { id, name, email } \| null` — one SQL query. |
| `POST /boards/:id/tasks` | `{ title, status?, assigneeId?, dueDate? }` — `dueDate` is `YYYY-MM-DD`; assignee must be a board member |
| `PATCH /tasks/:id` | Any subset of `{ title, status, assigneeId, dueDate }`; `null` clears assignee/due date. Unknown fields (e.g. `boardId`) are ignored. |
| `DELETE /tasks/:id` | Any board member |

## Probes

| Path | Checks | Use for |
|---|---|---|
| `GET /health` | Nothing but "is the process up" | Liveness — never fails because of the database, so an outage doesn't get the process killed and restarted in a loop |
| `GET /ready` | A live database query; `503 SHUTTING_DOWN` while the process is draining for shutdown | Readiness — whether a load balancer should send traffic here |

Every response also carries `X-Request-Id` (generated, or echoed back if the caller sent one and it looks like a safe id) and `Cache-Control: no-store`.
