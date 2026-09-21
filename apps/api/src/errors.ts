import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Every API error leaves the server as `{ error, code }` (plus optional `details`),
 * with an appropriate HTTP status. The SPA's global fetch wrapper relies on this shape.
 */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = "Authentication required", code = "UNAUTHORIZED") =>
  new AppError(401, code, message);
export const forbidden = (message = "You don't have access to this resource") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found", code = "NOT_FOUND") =>
  new AppError(404, code, message);
export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new AppError(429, "RATE_LIMITED", message, { retryAfterSeconds });
