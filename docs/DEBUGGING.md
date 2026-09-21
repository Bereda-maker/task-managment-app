# Debugging: the JWT that silently expires mid-session

**Symptom:** people report being "randomly logged out" — usually about 15 minutes after logging in, and never while a page is being actively reloaded.

**Cause:** access tokens are deliberately short-lived. Once one expires, every API call returns `401`. Without a refresh flow, that looks exactly like a random logout.

## Diagnosing it in the browser

1. Open DevTools → **Network**, filter by `Fetch/XHR`.
2. Find the first failing request. Status **401**, and look at the response body:
   ```json
   { "error": "Access token expired", "code": "TOKEN_EXPIRED" }
   ```
   `TOKEN_EXPIRED` means "refresh and retry". `INVALID_TOKEN` means the token is malformed or signed with a different secret (e.g. `JWT_SECRET` changed between deploys) — that's a different bug.
3. Check the **timing**: the request time minus your login time ≈ `ACCESS_TOKEN_TTL_SECONDS` (900 s by default). That's the tell.
4. Look for a `POST /auth/refresh` immediately after the 401. If it's there and returns `200`, the app is healing itself. If it's missing, the refresh flow isn't running; if it returns `401 INVALID_REFRESH_TOKEN`, the refresh cookie is expired, revoked, or wasn't sent (check `credentials: "include"`, `SameSite`, and CORS — see SECURITY.md).

## The fix (already implemented)

`apps/web/src/lib/api.ts`:

- On a `401`, make **one** `POST /auth/refresh`, then retry the original request with the new token.
- Refresh is **single-flight**: if five requests expire together, one refresh is made and all five wait for it. (Refresh tokens rotate, so parallel refreshes would make all but one fail — and look like a logout.)
- If the refresh itself fails, sign out cleanly and show one toast.

To watch it happen, set `ACCESS_TOKEN_TTL_SECONDS=10` in `apps/api/.env`, log in, wait ten seconds, then move a task: the Network tab shows `401 → refresh 200 → retry 200`, and the UI never flinches. The behaviour is covered by `apps/web/src/lib/api.test.ts` and `apps/api/test/auth.test.ts`.
