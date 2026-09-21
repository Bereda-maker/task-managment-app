import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { JwtTokenExpired } from "hono/utils/jwt/types";
import { config } from "../config";
import { unauthorized } from "../errors";
import type { AppEnv } from "../types";

/**
 * Step 1 of every protected endpoint: authenticate.
 *
 * Expired tokens get their own code (TOKEN_EXPIRED) so the SPA can tell "silently refresh and
 * retry" apart from "this token is garbage — send the user to the login page".
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const [scheme, token] = (c.req.header("Authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    throw unauthorized("Missing bearer token", "UNAUTHORIZED");
  }

  try {
    const payload = await verify(token, config.JWT_SECRET, "HS256");
    if (typeof payload.sub !== "string") throw new Error("token has no subject");
    c.set("userId", payload.sub);
  } catch (err) {
    if (err instanceof JwtTokenExpired) throw unauthorized("Access token expired", "TOKEN_EXPIRED");
    throw unauthorized("Invalid access token", "INVALID_TOKEN");
  }

  await next();
});
