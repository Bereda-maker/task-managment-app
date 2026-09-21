import { createMiddleware } from "hono/factory";
import { config } from "../config";
import { forbidden } from "../errors";

/**
 * Defence-in-depth for the cookie-authenticated endpoints (/auth/refresh, /auth/logout).
 * Browsers always send Origin on cross-origin POSTs, so a request from any site other than
 * the SPA is rejected even if the refresh cookie would have been attached. Non-browser
 * clients (curl, tests) don't send Origin and are unaffected.
 */
export const requireAllowedOrigin = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== config.FRONTEND_ORIGIN) {
    throw forbidden("Origin not allowed");
  }
  await next();
});
