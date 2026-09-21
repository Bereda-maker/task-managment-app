import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

/** Applies all pending SQL migrations from apps/api/drizzle. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  // Migrations get their own single-connection client so they never fight the app pool.
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
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
