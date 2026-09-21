/**
 * Preloaded by bunfig.toml BEFORE any test file (and therefore before src/config.ts) is imported.
 *
 * Tests run against a REAL, disposable PostgreSQL (docker compose service `db-test`, tmpfs-backed)
 * — not a mock. Because tests TRUNCATE tables, we refuse to run against any database whose name
 * doesn't end in `_test`.
 */
import { runMigrations } from "../src/db/migrate";

const url =
  process.env.TEST_DATABASE_URL ?? "postgres://taskboard:taskboard@localhost:5433/taskboard_test";

const dbName = new URL(url).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests against "${dbName}": test databases must end in "_test" (tests wipe every table).`,
  );
}

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: url,
  JWT_SECRET: "test-secret-test-secret-test-secret-123456",
  FRONTEND_ORIGIN: "http://localhost:5173",
  BCRYPT_COST: "4", // fast hashing; production default is 10
  LOGIN_RATE_LIMIT_MAX: "5",
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: "60",
  TRUST_PROXY: "true", // lets tests choose the "client IP" via X-Forwarded-For
});

await runMigrations(url);
