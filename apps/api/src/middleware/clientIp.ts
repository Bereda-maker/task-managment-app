import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { config } from "../config";

/**
 * Best-effort client IP for rate limiting.
 * X-Forwarded-For is client-controlled unless a trusted proxy overwrites it, so it is only
 * honoured when TRUST_PROXY=true. Otherwise we use the socket's address.
 */
export function getClientIp(c: Context): string {
  if (config.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // e.g. app.request() in tests — there's no socket
  }
}
