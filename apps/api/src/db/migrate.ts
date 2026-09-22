import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

// Arbitrary but fixed: every instance must ask for the same lock.
const MIGRATION_LOCK_ID = 727_274;

/**
 * Applies all pending SQL migrations from apps/api/drizzle. Safe to run repeatedly AND safe to
 * run from several processes at once: a Postgres advisory lock makes concurrent runners take
 * turns, so two instances booting together (with MIGRATE_ON_START=true) can't collide on
 * "relation already exists". The second waits, then finds nothing left to apply.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  // A single connection: the session-level advisory lock, the migrator, and the unlock all
  // share it. It also never competes with the app's own pool.
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    // Closing the connection also releases the lock; unlock explicitly for clarity.
    await client`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => {});
    await client.end();
  }
}

// `bun src/db/migrate.ts` (npm script: db:migrate)
if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  await runMigrations(url);
  console.log("Migrations applied.");
}
