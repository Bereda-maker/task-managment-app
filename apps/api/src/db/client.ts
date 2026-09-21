import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

export const sql = postgres(config.DATABASE_URL, {
  max: config.isTest ? 5 : 10,
  // Quiet Postgres NOTICE spam (e.g. "table does not exist, skipping").
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
