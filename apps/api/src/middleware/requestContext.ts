import { createMiddleware } from "hono/factory";
import { log } from "../lib/logger";
import { getClientIp } from "./clientIp";
import type { AppEnv } from "../types";

// Accept an upstream id (from a load balancer / gateway) only if it's short and boring, so it
// can't be used to inject junk into logs.
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives every request an id (returned as X-Request-Id and included in the log line and in
 * 500 responses) and writes one structured access-log line per request. Logs the path only —
 * never the query string, body, or Authorization header.
 */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const inbound = c.req.header("X-Request-Id");
  const requestId = inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);

  const started = performance.now();
  await next();

  const status = c.res.status;
  const isProbe = c.req.path === "/health" || c.req.path === "/ready";
  const fields = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: Math.round(performance.now() - started),
    ip: getClientIp(c),
    userId: c.get("userId"),
  };
  if (status >= 500) log.error("request failed", fields);
  else log[isProbe ? "debug" : "info"]("request", fields);
});
