import { describe, expect, it } from "bun:test";
import { ConfigError, buildConfig } from "../src/config";

const base = {
  DATABASE_URL: "postgres://u:p@db.internal:5432/app",
  JWT_SECRET: "k9Vx2mQpL7rTzW4nB8cYdF3hJ6sA1eGu0oIiXyZq5R=",
};
const prod = { ...base, NODE_ENV: "production", FRONTEND_ORIGIN: "https://tasks.example.com" };

const problems = (env: Record<string, string>) => {
  try {
    buildConfig(env);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as Error).message.split("\n").filter((l) => l.startsWith("  - "));
  }
};

describe("buildConfig", () => {
  it("accepts a valid production config and secures the cookie for cross-site use", () => {
    const c = buildConfig(prod);
    expect(c.isProd).toBe(true);
    expect(c.cookie).toMatchObject({ secure: true, sameSite: "None", path: "/auth" });
    expect(c.FRONTEND_ORIGIN).toBe("https://tasks.example.com");
  });

  it("uses safe defaults in development", () => {
    const c = buildConfig(base);
    expect(c.cookie).toMatchObject({ secure: false, sameSite: "Lax" });
    expect(c.FRONTEND_ORIGIN).toBe("http://localhost:5173");
    expect(c.API_RATE_LIMIT_MAX).toBe(300);
  });

  it("normalises a trailing slash on the frontend origin", () => {
    expect(buildConfig({ ...prod, FRONTEND_ORIGIN: "https://tasks.example.com/" }).FRONTEND_ORIGIN).toBe("https://tasks.example.com");
  });

  it("refuses to start in production with a placeholder JWT secret", () => {
    const p = problems({ ...prod, JWT_SECRET: "change-me-to-a-long-random-string-at-least-32-chars" });
    expect(p.join()).toContain("JWT_SECRET looks like a placeholder");
  });

  it("refuses a short JWT secret in any environment", () => {
    expect(problems({ ...base, JWT_SECRET: "too-short" }).join()).toContain("at least 32 characters");
  });

  it("requires FRONTEND_ORIGIN in production instead of silently defaulting to localhost", () => {
    const { FRONTEND_ORIGIN: _omit, ...noOrigin } = prod;
    expect(problems(noOrigin).join()).toContain("FRONTEND_ORIGIN must be set in production");
  });

  it("requires https (and a bare origin) for FRONTEND_ORIGIN in production", () => {
    expect(problems({ ...prod, FRONTEND_ORIGIN: "http://tasks.example.com" }).join()).toContain("must be https");
    expect(problems({ ...prod, FRONTEND_ORIGIN: "https://tasks.example.com/app" }).join()).toContain("origin only");
  });

  it("still lets you run production mode locally against http://localhost", () => {
    expect(() => buildConfig({ ...prod, FRONTEND_ORIGIN: "http://localhost:5173" })).not.toThrow();
  });

  it("rejects SameSite=None outside production (browsers drop non-Secure None cookies)", () => {
    expect(problems({ ...base, COOKIE_SAMESITE: "None" }).join()).toContain("requires Secure cookies");
  });

  it("reports every problem at once, not just the first", () => {
    const p = problems({ ...prod, JWT_SECRET: "change-me-change-me-change-me-change-me", FRONTEND_ORIGIN: "http://x.example.com" });
    expect(p.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects out-of-range numbers", () => {
    expect(problems({ ...base, PORT: "0" }).length).toBe(1);
    expect(problems({ ...base, BCRYPT_COST: "2" }).length).toBe(1);
  });
});
