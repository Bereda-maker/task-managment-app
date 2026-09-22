import { describe, expect, it } from "bun:test";
import { app } from "../src/app";

const ALLOWED = "http://localhost:5173";

describe("CORS", () => {
  it("answers the preflight for the exact frontend origin, with credentials", async () => {
    const res = await app.request("/boards", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED,
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
  });

  it("never sends a wildcard", async () => {
    const res = await app.request("/health", { headers: { Origin: ALLOWED } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("gives any other origin no CORS headers, so the browser blocks it", async () => {
    for (const origin of ["https://evil.example", "http://localhost:5174", "http://localhost:5173.evil.example"]) {
      const res = await app.request("/health", { headers: { Origin: origin } });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });
});

describe("misc", () => {
  it("unknown routes return the standard { error, code } shape", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Route not found", code: "NOT_FOUND" });
  });

  it("rejects oversized request bodies with 413 in the standard error shape", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.9" },
      body: JSON.stringify({ email: "a@b.io", password: "x".repeat(200 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
  });
});
