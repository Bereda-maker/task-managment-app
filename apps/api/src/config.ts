import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const int = (def: number, min = 1) => z.coerce.number().int().min(min).default(def);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_SECONDS: int(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: int(7),
  FRONTEND_ORIGIN: z
    .string()
    .url()
    .optional()
    // Origins never have a trailing slash; normalise so string comparison works.
    .transform((v) => v?.replace(/\/+$/, "")),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  COOKIE_SAMESITE: z.enum(["Lax", "Strict", "None"]).optional(),
  TRUST_PROXY: bool,
  MIGRATE_ON_START: bool,

  // Rate limiting (per client IP, in-memory per process)
  LOGIN_RATE_LIMIT_MAX: int(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: int(15 * 60),
  REGISTER_RATE_LIMIT_MAX: int(10),
  REGISTER_RATE_LIMIT_WINDOW_SECONDS: int(60 * 60),
  API_RATE_LIMIT_MAX: int(300),
  API_RATE_LIMIT_WINDOW_SECONDS: int(60),

  // Database pool
  DB_POOL_MAX: int(10),
  DB_CONNECT_TIMEOUT_SECONDS: int(10),
  DB_IDLE_TIMEOUT_SECONDS: int(30),
  DB_STATEMENT_TIMEOUT_MS: int(15_000),

  // Abuse guard: the board endpoint returns every task, so the count must be bounded.
  MAX_TASKS_PER_BOARD: int(1000),

  // Operations
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  SHUTDOWN_TIMEOUT_SECONDS: int(10),
});

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\n\nSee apps/api/.env.example`);
    this.name = "ConfigError";
  }
}

const isLocalHost = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

/**
 * Validates and derives the app config from an environment map. Pure (no globals), so the
 * production guard-rails below can be unit-tested.
 */
export function buildConfig(source: Record<string, string | undefined>) {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`));
  }

  const env = parsed.data;
  const isProd = env.NODE_ENV === "production";
  const problems: string[] = [];

  if (isProd) {
    // Things that are convenient defaults in development and dangerous in production.
    if (/change-?me|example|secret-secret/i.test(env.JWT_SECRET)) {
      problems.push("JWT_SECRET looks like a placeholder. Generate one: openssl rand -base64 48");
    }
    if (!env.FRONTEND_ORIGIN) {
      problems.push("FRONTEND_ORIGIN must be set in production (the exact origin of the web app — CORS is locked to it)");
    } else {
      const origin = new URL(env.FRONTEND_ORIGIN);
      if (origin.protocol !== "https:" && !isLocalHost(origin)) {
        problems.push(`FRONTEND_ORIGIN must be https in production (got ${env.FRONTEND_ORIGIN})`);
      }
      if (origin.pathname !== "/" || origin.search || origin.hash) {
        problems.push("FRONTEND_ORIGIN must be an origin only (scheme://host[:port]) with no path");
      }
    }
  }
  if (env.COOKIE_SAMESITE === "None" && !isProd) {
    problems.push("COOKIE_SAMESITE=None requires Secure cookies, which are only enabled when NODE_ENV=production");
  }
  if (problems.length) throw new ConfigError(problems);

  return {
    ...env,
    FRONTEND_ORIGIN: env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    isProd,
    isTest: env.NODE_ENV === "test",
    cookie: {
      name: "refresh_token",
      // Scoped so the browser only sends the refresh cookie to the auth endpoints.
      path: "/auth",
      secure: isProd,
      // Frontend and API are usually on different sites in production, which requires
      // SameSite=None (and therefore Secure). In dev, localhost:5173 -> localhost:3000 is same-site.
      sameSite: (env.COOKIE_SAMESITE ?? (isProd ? "None" : "Lax")) as "Lax" | "Strict" | "None",
      maxAgeSeconds: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    },
  } as const;
}

export const config = buildConfig(process.env);
export type Config = typeof config;
