import { createMiddleware } from "hono/factory";
import { tooManyRequests } from "../errors";
import { getClientIp } from "./clientIp";

interface Options {
  /** Requests allowed per window, per client IP. */
  max: number;
  windowMs: number;
  message?: string;
}

/**
 * Small in-memory fixed-window limiter, keyed by client IP.
 *
 * In-memory means the count is per API process: fine for a single container, and worth
 * swapping for Redis (see Project 4+) if you scale horizontally.
 */
export function rateLimit({ max, windowMs, message = "Too many attempts. Try again later." }: Options) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Keep the map from growing forever. unref() so this timer never keeps the process alive.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 60_000)).unref();

  const middleware = createMiddleware(async (c, next) => {
    const key = getClientIp(c);
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      throw tooManyRequests(message, retryAfter);
    }
    await next();
  });

  return Object.assign(middleware, { reset: () => hits.clear() });
}
