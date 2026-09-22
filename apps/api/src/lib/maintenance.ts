import { and, isNotNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { refreshTokens } from "../db/schema";
import { errorFields, log } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes refresh tokens that are expired, or were revoked more than a day ago. Returns how many. */
export async function purgeDeadRefreshTokens(now = new Date()): Promise<number> {
  const deleted = await db
    .delete(refreshTokens)
    .where(
      or(
        lt(refreshTokens.expiresAt, now),
        and(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, new Date(now.getTime() - DAY_MS))),
      ),
    )
    .returning({ id: refreshTokens.id });
  return deleted.length;
}

/** Runs the purge now and then hourly. The timer is unref'd so it never keeps the process alive. */
export function startMaintenance(): () => void {
  const run = () =>
    purgeDeadRefreshTokens()
      .then((n) => n > 0 && log.info("purged dead refresh tokens", { count: n }))
      .catch((err) => log.error("token purge failed", errorFields(err)));
  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
