import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { config } from "./config";
import { sql } from "./db/client";
import { AppError } from "./errors";
import { isDraining } from "./lib/lifecycle";
import { errorFields, log } from "./lib/logger";
import { noStore } from "./middleware/noStore";
import { rateLimit } from "./middleware/rateLimit";
import { requestContext } from "./middleware/requestContext";
import { authRoutes } from "./routes/auth";
import { boardRoutes } from "./routes/boards";
import { taskRoutes } from "./routes/tasks";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("*", requestContext);
app.use("*", secureHeaders());
app.use("*", noStore);
app.use(
  "*",
  bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) => c.json({ error: "Request body is too large", code: "PAYLOAD_TOO_LARGE" }, 413),
  }),
);

/**
 * CORS. The SPA and the API live on different origins, so the browser blocks the SPA from
 * calling the API unless the API opts in explicitly.
 *
 * - Only the exact configured origin is echoed back — never "*" (which is also illegal when
 *   credentials are allowed, and we need credentials for the refresh-token cookie).
 * - Any other origin gets NO Access-Control-Allow-Origin header, so the browser refuses it.
 *
 * "It works in Postman but not in the browser" is what a missing/wrong config looks like:
 * Postman doesn't enforce CORS, browsers do. See docs/SECURITY.md.
 */
app.use(
  "*",
  cors({
    origin: (origin) => (origin === config.FRONTEND_ORIGIN ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Request-Id", "Retry-After"], // readable by the SPA (e.g. to show a support reference)
    maxAge: 600,
  }),
);

/** A generous per-IP ceiling on everything except the probes. The stricter login/register limits sit on top. */
export const apiLimiter = rateLimit({
  max: config.API_RATE_LIMIT_MAX,
  windowMs: config.API_RATE_LIMIT_WINDOW_SECONDS * 1000,
  message: "Too many requests. Slow down and try again shortly.",
});
app.use("*", async (c, next) => {
  if (c.req.path === "/health" || c.req.path === "/ready") return next();
  return apiLimiter(c, next);
});

/** Liveness: the process is up. Deliberately does NOT touch the database, so a DB outage doesn't get pods restarted in a loop. */
app.get("/health", (c) => c.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));

/** Readiness: safe to send traffic? Needs the database, and goes 503 while the process is draining for shutdown. */
app.get("/ready", async (c) => {
  if (isDraining()) return c.json({ status: "draining", code: "SHUTTING_DOWN" }, 503);
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database check timed out")), 2000).unref()),
    ]);
    return c.json({ status: "ready" });
  } catch (err) {
    log.error("readiness check failed", { requestId: c.get("requestId"), ...errorFields(err) });
    return c.json({ status: "unavailable", code: "DB_UNAVAILABLE" }, 503);
  }
});

app.route("/auth", authRoutes);
app.route("/boards", boardRoutes);
app.route("/tasks", taskRoutes);

app.notFound((c) => c.json({ error: "Route not found", code: "NOT_FOUND" }, 404));

// One place turns every failure into `{ error, code }` with the right status.
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code, ...(err.details !== undefined ? { details: err.details } : {}) },
      err.status,
    );
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return c.json({ error: details[0]?.message ?? "Validation failed", code: "VALIDATION_ERROR", details }, 400);
  }

  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "Request failed", code: "HTTP_ERROR" }, err.status);
  }

  // Full detail goes to the log (keyed by request id); the client gets only the id to quote.
  const requestId = c.get("requestId");
  log.error("unhandled error", { requestId, method: c.req.method, path: c.req.path, ...errorFields(err) });
  return c.json({ error: "Something went wrong on our side", code: "INTERNAL_ERROR", requestId }, 500);
});
