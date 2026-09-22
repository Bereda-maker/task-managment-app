import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

export const sql = postgres(config.DATABASE_URL, {
  max: config.isTest ? 5 : config.DB_POOL_MAX,
  connect_timeout: config.DB_CONNECT_TIMEOUT_SECONDS,
  idle_timeout: config.DB_IDLE_TIMEOUT_SECONDS,
  // Runtime parameters sent at connection start. A runaway query is cancelled by Postgres
  // instead of pinning a pooled connection forever.
  connection: {
    application_name: "taskboard-api",
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  },
  // Quiet Postgres NOTICE spam (e.g. "table does not exist, skipping").
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
