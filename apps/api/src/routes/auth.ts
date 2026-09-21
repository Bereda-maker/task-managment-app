import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config";
import { db } from "../db/client";
import { users } from "../db/schema";
import { conflict, unauthorized } from "../errors";
import { getDummyHash, hashPassword, verifyPassword } from "../lib/password";
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken } from "../lib/tokens";
import { LoginBody, RegisterBody, parseBody } from "../lib/validation";
import { authMiddleware } from "../middleware/auth";
import { requireAllowedOrigin } from "../middleware/origin";
import { rateLimit } from "../middleware/rateLimit";
import type { AppEnv } from "../types";

export const loginLimiter = rateLimit({
  max: config.LOGIN_RATE_LIMIT_MAX,
  windowMs: config.LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000,
  message: "Too many login attempts. Please wait a few minutes and try again.",
});

const cookieOptions = {
  httpOnly: true, // invisible to JavaScript, so an XSS bug can't read it
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  path: config.cookie.path,
} as const;

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, config.cookie.name, token, { ...cookieOptions, maxAge: config.cookie.maxAgeSeconds });
}

function clearRefreshCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, config.cookie.name, cookieOptions);
}

const publicUser = { id: users.id, name: users.name, email: users.email };

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/register", async (c) => {
  const body = await parseBody(c, RegisterBody);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (existing) throw conflict("An account with that email already exists", "EMAIL_TAKEN");

  const passwordHash = await hashPassword(body.password);
  let user: { id: string; name: string; email: string };
  try {
    const [created] = await db
      .insert(users)
      .values({ name: body.name, email: body.email, passwordHash })
      .returning(publicUser);
    user = created!;
  } catch (err) {
    // Two simultaneous registrations for one email: the unique index is the real guard.
    if (isUniqueViolation(err)) throw conflict("An account with that email already exists", "EMAIL_TAKEN");
    throw err;
  }

  setRefreshCookie(c, await issueRefreshToken(user.id));
  return c.json({ user, accessToken: await signAccessToken(user.id) }, 201);
});

authRoutes.post("/login", loginLimiter, async (c) => {
  const body = await parseBody(c, LoginBody);

  const [row] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  // Always run a bcrypt comparison, even for unknown emails, to keep timing uniform.
  const passwordOk = await verifyPassword(body.password, row?.passwordHash ?? (await getDummyHash()));
  if (!row || !passwordOk) throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");

  setRefreshCookie(c, await issueRefreshToken(row.id));
  return c.json({
    user: { id: row.id, name: row.name, email: row.email },
    accessToken: await signAccessToken(row.id),
  });
});

/**
 * Called by the SPA (a) on page load to restore a session after a browser restart and
 * (b) when an access token expires mid-session. Rotates the refresh token every time.
 */
authRoutes.post("/refresh", requireAllowedOrigin, async (c) => {
  const raw = getCookie(c, config.cookie.name);
  if (!raw) {
    return c.json({ error: "No active session", code: "NO_SESSION" }, 401);
  }

  const rotated = await rotateRefreshToken(raw);
  if (!rotated) {
    clearRefreshCookie(c);
    return c.json({ error: "Session expired. Please log in again.", code: "INVALID_REFRESH_TOKEN" }, 401);
  }

  const [user] = await db.select(publicUser).from(users).where(eq(users.id, rotated.userId)).limit(1);
  if (!user) {
    clearRefreshCookie(c);
    return c.json({ error: "Session expired. Please log in again.", code: "INVALID_REFRESH_TOKEN" }, 401);
  }

  setRefreshCookie(c, rotated.refreshToken);
  return c.json({ user, accessToken: await signAccessToken(user.id) });
});

authRoutes.post("/logout", requireAllowedOrigin, async (c) => {
  const raw = getCookie(c, config.cookie.name);
  if (raw) await revokeRefreshToken(raw);
  clearRefreshCookie(c);
  return c.body(null, 204);
});

authRoutes.get("/me", authMiddleware, async (c) => {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, c.get("userId"))).limit(1);
  if (!user) throw unauthorized("Account no longer exists", "INVALID_TOKEN");
  return c.json({ user });
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
