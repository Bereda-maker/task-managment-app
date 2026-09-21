import { app } from "./app";
import { config } from "./config";
import { runMigrations } from "./db/migrate";

if (config.MIGRATE_ON_START) {
  await runMigrations(config.DATABASE_URL);
  console.log("Migrations applied.");
}

console.log(`Task Board API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);

// Bun serves the default export. `fetch` receives the server as its 2nd argument,
// which is how the rate limiter looks up the client's IP.
export default {
  port: config.PORT,
  fetch: app.fetch,
};
