import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { sign } from "hono/jwt";
import { config } from "../config";
import { db } from "../db/client";
import { refreshTokens } from "../db/schema";

/** Short-lived JWT, held in memory by the SPA and sent as `Authorization: Bearer`. */
export async function signAccessToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, iat: now, exp: now + config.ACCESS_TOKEN_TTL_SECONDS }, config.JWT_SECRET, "HS256");
}

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

/** Creates a refresh token, stores only its hash, and returns the raw value for the cookie. */
export async function issueRefreshToken(userId: string): Promise<string> {
  // Opportunistic housekeeping: drop this user's dead tokens whenever they get a new one.
  await db
    .delete(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        or(lt(refreshTokens.expiresAt, new Date()), // expired
           // revoked more than a day ago (keep very recent ones so races stay diagnosable)
           lt(refreshTokens.revokedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))),
      ),
    );

  const raw = randomToken();
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + config.cookie.maxAgeSeconds * 1000),
  });
  return raw;
}

/**
 * Exchanges a valid refresh token for a new one (rotation). The old token is revoked with a
 * single atomic UPDATE, so if two requests race with the same token exactly one wins.
 * Returns null when the token is unknown, expired, or already used.
 */
export async function rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string } | null> {
  const [revoked] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.tokenHash, sha256(raw)),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: refreshTokens.userId });

  if (!revoked) return null;
  return { userId: revoked.userId, refreshToken: await issueRefreshToken(revoked.userId) };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(raw)), isNull(refreshTokens.revokedAt)));
}
