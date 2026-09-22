import { app } from "./app";
import { config } from "./config";
import { sql } from "./db/client";
import { runMigrations } from "./db/migrate";
import { startDraining } from "./lib/lifecycle";
import { errorFields, log } from "./lib/logger";
import { startMaintenance } from "./lib/maintenance";

if (config.MIGRATE_ON_START) {
  await runMigrations(config.DATABASE_URL);
  log.info("migrations applied");
}

// `fetch` receives the server as its 2nd argument, which is how the rate limiter finds the
// client's socket IP.
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
const stopMaintenance = startMaintenance();

log.info("api listening", { port: server.port, env: config.NODE_ENV, origin: config.FRONTEND_ORIGIN });

// ---- Graceful shutdown -------------------------------------------------------------------
// Orchestrators send SIGTERM on every deploy/scale-down. Without handling it, in-flight
// requests are cut off mid-write. Instead: go "not ready" (so the load balancer stops sending
// traffic), let in-flight requests finish, close the DB pool, exit 0. A watchdog forces exit
// if that takes too long.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  startDraining();
  log.info("shutting down", { signal });

  const watchdog = setTimeout(() => {
    log.error("shutdown timed out; forcing exit", { timeoutSeconds: config.SHUTDOWN_TIMEOUT_SECONDS });
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_SECONDS * 1000);
  watchdog.unref();

  try {
    stopMaintenance();
    await server.stop(); // stop accepting; waits for in-flight requests
    await sql.end({ timeout: 5 });
    log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    log.error("error during shutdown", errorFields(err));
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Log, don't swallow. A process in an unknown state should die and be restarted by the platform.
process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", errorFields(reason)));
process.on("uncaughtException", (err) => {
  log.error("uncaught exception", errorFields(err));
  process.exit(1);
});
