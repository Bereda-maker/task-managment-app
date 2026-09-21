import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  FRONTEND_ORIGIN: z
    .string()
    .url()
    .default("http://localhost:5173")
    // Origins never have a trailing slash; normalise so string comparison works.
    .transform((v) => v.replace(/\/+$/, "")),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  TRUST_PROXY: bool,
  MIGRATE_ON_START: bool,
  COOKIE_SAMESITE: z.enum(["Lax", "Strict", "None"]).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${problems}\n\nSee apps/api/.env.example`);
}

const env = parsed.data;
const isProd = env.NODE_ENV === "production";

export const config = {
  ...env,
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

export type Config = typeof config;
