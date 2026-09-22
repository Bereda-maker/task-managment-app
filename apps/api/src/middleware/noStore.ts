import { createMiddleware } from "hono/factory";

/** API responses are per-user and must never be stored by browsers, proxies or CDNs. */
export const noStore = createMiddleware(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
