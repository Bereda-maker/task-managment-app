import { beforeEach, describe, expect, it } from "bun:test";
import { sign } from "hono/jwt";
import { loginLimiter } from "../src/routes/auth";
import { api, json, refreshCookieFrom, registerUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  loginLimiter.reset();
});

const creds = { name: "Ada Lovelace", email: "ada@example.com", password: "correct-horse-battery" };

describe("POST /auth/register", () => {
  it("creates an account, returns an access token and sets an httpOnly refresh cookie", async () => {
    const res = await api("POST", "/auth/register", { body: creds });
    expect(res.status).toBe(201);

    const body = await json(res);
    expect(body.user).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(body.user.passwordHash).toBeUndefined();
    expect(typeof body.accessToken).toBe("string");

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("refresh_token="))!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/auth");
  });

  it("normalises email case and rejects duplicates with 409 EMAIL_TAKEN", async () => {
    await api("POST", "/auth/register", { body: creds });
    const res = await api("POST", "/auth/register", { body: { ...creds, email: "  ADA@Example.com " } });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("EMAIL_TAKEN");
  });

  it("returns { error, code } with 400 for invalid input", async () => {
    const res = await api("POST", "/auth/register", { body: { name: "", email: "nope", password: "short" } });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(typeof body.error).toBe("string");
    expect(body.details.length).toBeGreaterThanOrEqual(3);
  });

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await api("POST", "/auth/register", { rawBody: "{not json" });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("INVALID_JSON");
  });

  it("stores a bcrypt hash, never the plain password", async () => {
    await api("POST", "/auth/register", { body: creds });
    const { sql } = await import("../src/db/client");
    const [row] = await sql`select password_hash from users where email = ${creds.email}`;
    expect(row!.password_hash).toStartWith("$2");
    expect(row!.password_hash).not.toContain(creds.password);
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    await api("POST", "/auth/register", { body: creds });
    const res = await api("POST", "/auth/login", { body: { email: creds.email, password: creds.password } });
    expect(res.status).toBe(200);
    expect((await json(res)).accessToken).toBeTruthy();
    expect(refreshCookieFrom(res)).toBeTruthy();
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    await api("POST", "/auth/register", { body: creds });
    const wrongPassword = await api("POST", "/auth/login", { body: { email: creds.email, password: "wrong-password" } });
    const unknownEmail = await api("POST", "/auth/login", { body: { email: "nobody@example.com", password: "whatever12" } });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await json(wrongPassword)).toEqual(await json(unknownEmail));
  });

  it("rate-limits login attempts per IP (429 + Retry-After) without affecting other IPs", async () => {
    await api("POST", "/auth/register", { body: creds });
    const attempt = (ip: string) =>
      api("POST", "/auth/login", { ip, body: { email: creds.email, password: "wrong-password" } });

    for (let i = 0; i < 5; i++) expect((await attempt("203.0.113.7")).status).toBe(401);

    const blocked = await attempt("203.0.113.7");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect((await json(blocked)).code).toBe("RATE_LIMITED");

    // A different client is unaffected.
    expect((await attempt("203.0.113.8")).status).toBe(401);
  });
});

describe("access tokens", () => {
  it("protects /auth/me and accepts a valid token", async () => {
    const user = await registerUser("Grace");
    expect((await api("GET", "/auth/me")).status).toBe(401);

    const res = await api("GET", "/auth/me", { token: user.token });
    expect(res.status).toBe(200);
    expect((await json(res)).user.email).toBe(user.email);
  });

  it("rejects a garbage token with INVALID_TOKEN", async () => {
    const res = await api("GET", "/auth/me", { token: "not.a.jwt" });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("INVALID_TOKEN");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = await sign({ sub: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 60 }, "x".repeat(40), "HS256");
    const res = await api("GET", "/boards", { token: forged });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("INVALID_TOKEN");
  });

  it("reports an expired token as TOKEN_EXPIRED (the signal the SPA uses to refresh)", async () => {
    const user = await registerUser();
    const expired = await sign(
      { sub: user.id, iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
      "HS256",
    );
    const res = await api("GET", "/boards", { token: expired });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("TOKEN_EXPIRED");
  });
});

describe("refresh-token flow", () => {
  it("restores a session from the cookie alone and rotates the refresh token", async () => {
    const user = await registerUser();

    const res = await api("POST", "/auth/refresh", { cookie: user.cookie });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.user.id).toBe(user.id);
    expect((await api("GET", "/auth/me", { token: body.accessToken })).status).toBe(200);

    const newCookie = refreshCookieFrom(res);
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(user.cookie);
  });

  it("refuses to reuse a refresh token once it has been rotated", async () => {
    const user = await registerUser();
    expect((await api("POST", "/auth/refresh", { cookie: user.cookie })).status).toBe(200);

    const replay = await api("POST", "/auth/refresh", { cookie: user.cookie });
    expect(replay.status).toBe(401);
    expect((await json(replay)).code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("lets exactly one of two simultaneous refreshes with the same token win", async () => {
    const user = await registerUser();
    const results = await Promise.all([
      api("POST", "/auth/refresh", { cookie: user.cookie }),
      api("POST", "/auth/refresh", { cookie: user.cookie }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("returns 401 NO_SESSION when there is no cookie", async () => {
    const res = await api("POST", "/auth/refresh");
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("NO_SESSION");
  });

  it("rejects refresh requests from a foreign Origin", async () => {
    const user = await registerUser();
    const res = await api("POST", "/auth/refresh", { cookie: user.cookie, headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("logout revokes the refresh token and clears the cookie", async () => {
    const user = await registerUser();
    const out = await api("POST", "/auth/logout", { cookie: user.cookie });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().join(";")).toContain("refresh_token=;");

    expect((await api("POST", "/auth/refresh", { cookie: user.cookie })).status).toBe(401);
  });

  it("stores refresh tokens hashed, never in the clear", async () => {
    const user = await registerUser();
    const raw = user.cookie.replace("refresh_token=", "");
    const { sql } = await import("../src/db/client");
    const rows = await sql`select token_hash from refresh_tokens`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.token_hash).not.toBe(raw);
    expect(rows[0]!.token_hash).toHaveLength(64); // sha-256 hex
  });
});
