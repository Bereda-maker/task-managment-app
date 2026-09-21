# Security notes

## CORS: "it works in Postman but not in the browser"

The SPA (`http://localhost:5173`) and API (`http://localhost:3000`) are different origins. Browsers block cross-origin calls unless the API opts in; Postman and curl don't enforce CORS at all — which is why a missing or wrong config only shows up in the browser.

What this API does (`apps/api/src/app.ts`):

- Echoes back **only** the exact `FRONTEND_ORIGIN`. Any other origin gets **no** `Access-Control-Allow-Origin` header, so the browser refuses it.
- Never `*` — and a wildcard is illegal anyway when credentials (the refresh cookie) are allowed.
- Answers preflights for `GET, POST, PATCH, DELETE` with `Authorization` and `Content-Type` headers.
- The SPA sends `credentials: "include"` on every request so the cookie travels.

**Symptom checklist** if the browser shows a CORS error: (1) is `FRONTEND_ORIGIN` exactly the SPA's origin — scheme, host, and port, no trailing path? (2) is the API actually up (a dead server looks like a CORS error)? (3) look at the *preflight* `OPTIONS` request in the Network tab, not just the failed one.

## Tokens and cookies

| | Access token | Refresh token |
|---|---|---|
| Form | JWT (HS256), 15 min | 32 random bytes, 7 days |
| Lives in | JS memory only | `httpOnly` cookie, `Path=/auth` |
| Stored server-side | no | **SHA-256 hash only**; rotated on every use |

- Production cookies are `Secure; SameSite=None` (frontend and API are normally on different sites). In development they're `SameSite=Lax` (`localhost` ports are same-site). Override with `COOKIE_SAMESITE`.
- Because a `SameSite=None` cookie is sent on cross-site requests, `/auth/refresh` and `/auth/logout` additionally reject a foreign `Origin` header.

## Passwords and login

- bcrypt (cost 10). Passwords over 72 bytes are rejected, not silently truncated.
- Wrong password and unknown email return the identical `401`, and a dummy bcrypt comparison runs for unknown emails so timing doesn't reveal which accounts exist.
- Login is rate-limited **per IP** (default 10 attempts / 15 min → `429` + `Retry-After`).

## Authorization and input

- Every query goes through Drizzle, which parameterizes values.
- Unknown JSON keys are stripped by Zod, so a client can't change `boardId` or `id` via `PATCH`.
- A task can only be assigned to a board member; non-members get `403` on every board and task endpoint.
- Request bodies are capped at 100 KB.

## Known limitations (deliberate, for a project of this size)

- **The rate limiter is in-memory**, so its counts are per API process. Behind several instances, use a shared store (Redis appears later in the book). Behind a reverse proxy, set `TRUST_PROXY=true` *only* if the proxy overwrites `X-Forwarded-For`; otherwise clients could spoof their IP.
- **Registration and "add teammate by email" reveal whether an email is registered.** That's inherent to invite-by-email in a small-team tool; a public product would use emailed invitations.
- **No email verification or password reset.**
- **Two browser tabs refreshing at the same instant** — one wins (rotation is atomic); the other is told to log in again on its next request, and its cookie is already valid.
- Polling means a removed member can still see a cached board for up to one interval; the API itself refuses them immediately.
