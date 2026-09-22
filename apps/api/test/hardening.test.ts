import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { app, apiLimiter } from "../src/app";
import { db, sql } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { setDraining } from "../src/lib/lifecycle";
import { purgeDeadRefreshTokens } from "../src/lib/maintenance";
import { registerLimiter } from "../src/routes/auth";
import { addMember, api, createBoard, createTask, json, registerUser, resetDb } from "./helpers";

/**
 * Bun's `expect(sql\`...\`).rejects.toThrow()` intermittently hangs (rather than failing)
 * against postgres.js's thenable query objects in this toolchain combination, so constraint
 * violations are asserted with a plain try/catch instead.
 */
async function expectDbError(query: Promise<unknown>, matching: RegExp) {
  try {
    await query;
  } catch (err) {
    expect((err as Error).message).toMatch(matching);
    return;
  }
  throw new Error(`Expected the query to be rejected (matching ${matching}), but it succeeded`);
}

beforeEach(async () => {
  await resetDb();
  apiLimiter.reset();
  registerLimiter.reset();
  setDraining(false);
});

describe("database enforces its own rules (not just TypeScript)", () => {
  async function seed() {
    const alice = await registerUser("Alice");
    const board = await createBoard(alice);
    return { alice, board };
  }

  it("rejects an invalid task status written straight to SQL", async () => {
    const { board } = await seed();
    await expectDbError(sql`insert into tasks (board_id, title, status) values (${board.id}, 'x', 'blocked')`, /tasks_status_valid/);
  });

  it("rejects empty and over-long task titles", async () => {
    const { board } = await seed();
    await expectDbError(sql`insert into tasks (board_id, title) values (${board.id}, '   ')`, /tasks_title_length/);
    await expectDbError(sql`insert into tasks (board_id, title) values (${board.id}, ${"x".repeat(201)})`, /tasks_title_length/);
  });

  it("rejects an invalid membership role and a second owner", async () => {
    const { board } = await seed();
    const bob = await registerUser("Bob");
    await expectDbError(sql`insert into board_members (board_id, user_id, role) values (${board.id}, ${bob.id}, 'admin')`, /board_members_role_valid/);
    await expectDbError(sql`insert into board_members (board_id, user_id, role) values (${board.id}, ${bob.id}, 'owner')`, /board_members_one_owner_idx/);
  });

  it("rejects a blank board name", async () => {
    const alice = await registerUser();
    await expectDbError(sql`insert into boards (name, owner_id) values ('  ', ${alice.id})`, /boards_name_length/);
  });
});

describe("probes", () => {
  it("/health is liveness only: 200 and never touches the database", async () => {
    const select = spyOn(db, "select");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });

  it("/ready is 200 when the database answers", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
  });

  it("/ready goes 503 while draining so load balancers stop sending traffic", async () => {
    setDraining(true);
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("SHUTTING_DOWN");
    // …but liveness stays green so the platform doesn't kill the process mid-drain.
    expect((await app.request("/health")).status).toBe(200);
  });

  it("probes are exempt from the API rate limit", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await app.request("/health", { headers: { "x-forwarded-for": "198.51.100.1" } });
      expect(res.status).toBe(200);
    }
  });
});

describe("request ids and error hygiene", () => {
  it("generates an X-Request-Id and honours a sane upstream one", async () => {
    const generated = await app.request("/health");
    expect(generated.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await app.request("/health", { headers: { "X-Request-Id": "gateway-abc-12345" } });
    expect(echoed.headers.get("X-Request-Id")).toBe("gateway-abc-12345");
  });

  it("replaces an upstream id that doesn't look like a safe id, instead of trusting it", async () => {
    // Header VALUES can't contain CR/LF at all (the Headers API strips such requests before
    // they reach any middleware) -- the real risk is a value that's well-formed HTTP but not a
    // short, boring token: spaces, punctuation, or something absurdly long.
    for (const bad of ["has spaces", "semi;colon", "x".repeat(200), ""]) {
      const res = await app.request("/health", { headers: { "X-Request-Id": bad } });
      expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("returns 500 with only a request id — never the underlying error", async () => {
    const user = await registerUser();
    const select = spyOn(db, "select").mockImplementation(() => {
      throw new Error("connection to 10.0.3.7 refused: password=hunter2");
    });
    const res = await api("GET", "/auth/me", { token: user.token });
    select.mockRestore();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; code: string; requestId: string };
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.requestId).toBe(res.headers.get("X-Request-Id")!);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("10.0.3.7");
  });

  it("marks every API response no-store", async () => {
    const user = await registerUser();
    const res = await api("GET", "/boards", { token: user.token });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a validly-signed token whose subject isn't a user id, before it reaches the database", async () => {
    const { sign } = await import("hono/jwt");
    const token = await sign({ sub: "1; drop table users", exp: Math.floor(Date.now() / 1000) + 60 }, process.env.JWT_SECRET!, "HS256");
    const res = await api("GET", "/boards", { token });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("INVALID_TOKEN");
  });
});

describe("abuse limits", () => {
  it("applies a general per-IP ceiling (429 + Retry-After), per client", async () => {
    const hit = (ip: string) => app.request("/boards", { headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 40; i++) expect((await hit("203.0.113.50")).status).toBe(401);

    const limited = await hit("203.0.113.50");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(((await limited.json()) as { code: string }).code).toBe("RATE_LIMITED");
    expect((await hit("203.0.113.51")).status).toBe(401); // someone else is fine
  });

  it("throttles sign-ups per IP", async () => {
    const attempt = () => api("POST", "/auth/register", { ip: "203.0.113.60", body: {} });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);
  });

  it("caps tasks per board (409 TASK_LIMIT_REACHED) but only for that board", async () => {
    const alice = await registerUser();
    const board = await createBoard(alice);
    const other = await createBoard(alice, "Other");
    for (let i = 0; i < 5; i++) await createTask(alice, board.id, { title: `t${i}` });

    const res = await api("POST", `/boards/${board.id}/tasks`, { token: alice.token, body: { title: "one too many" } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("TASK_LIMIT_REACHED");

    await createTask(alice, other.id, { title: "fine here" });
    // Deleting frees a slot.
    const first = (await json(await api("GET", `/boards/${board.id}/tasks`, { token: alice.token }))).tasks[0];
    await api("DELETE", `/tasks/${first.id}`, { token: alice.token });
    expect((await api("POST", `/boards/${board.id}/tasks`, { token: alice.token, body: { title: "now ok" } })).status).toBe(201);
  });
});

describe("maintenance", () => {
  it("purges expired and long-revoked refresh tokens but keeps live and recently-revoked ones", async () => {
    const user = await registerUser();
    const day = 86_400_000;
    // postgres.js's raw tagged-template queries want plain values, not Date objects, for a
    // timestamp column -- pass ISO strings (this is exactly what Drizzle does for us elsewhere).
    const insert = (hash: string, expiresOffset: number, revokedOffset: number | null) =>
      sql`insert into refresh_tokens (user_id, token_hash, expires_at, revoked_at)
          values (${user.id}, ${hash}, ${new Date(Date.now() + expiresOffset).toISOString()}, ${
            revokedOffset === null ? null : new Date(Date.now() + revokedOffset).toISOString()
          })`;

    await insert("expired", -day, null);
    await insert("revoked-long-ago", 7 * day, -3 * day);
    await insert("revoked-just-now", 7 * day, -1000);
    await insert("live", 7 * day, null);

    expect(await purgeDeadRefreshTokens()).toBe(2);
    const left = (await sql`select token_hash from refresh_tokens where token_hash in ('expired','revoked-long-ago','revoked-just-now','live') order by token_hash`).map((r) => r.token_hash);
    expect(left).toEqual(["live", "revoked-just-now"]);
  });
});

describe("migrations", () => {
  const adminUrl = process.env.DATABASE_URL!;
  const lockDb = "taskboard_lock_test";
  const lockUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${lockDb}$1`);

  afterAll(async () => {
    await sql.unsafe(`drop database if exists ${lockDb}`);
  });

  it("two processes migrating a fresh database at once both succeed (advisory lock)", async () => {
    await sql.unsafe(`drop database if exists ${lockDb}`);
    await sql.unsafe(`create database ${lockDb}`);

    // Without the lock, concurrent runners collide on "relation already exists".
    await Promise.all([runMigrations(lockUrl), runMigrations(lockUrl), runMigrations(lockUrl)]);

    const postgres = (await import("postgres")).default;
    const check = postgres(lockUrl, { max: 1 });
    try {
      const rows = await check<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
      expect(rows[0]!.n).toBe(2); // 0000_init + 0001_data_integrity, each applied exactly once
      const tableRows = await check<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
      const tables = tableRows.map((r) => r.table_name);
      expect(tables).toEqual(["board_members", "boards", "refresh_tokens", "tasks", "users"]);
    } finally {
      await check.end();
    }
  });
});

describe("the real process", () => {
  const cwd = join(import.meta.dir, "..");
  const validProd = {
    NODE_ENV: "production",
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: "k9Vx2mQpL7rTzW4nB8cYdF3hJ6sA1eGu0oIiXyZq5R=",
    FRONTEND_ORIGIN: "https://tasks.example.com",
    LOG_LEVEL: "info",
  };

  const spawn = (env: Record<string, string>) =>
    Bun.spawn([process.execPath, "src/index.ts"], { cwd, env: { PATH: process.env.PATH!, ...env }, stdout: "pipe", stderr: "pipe" });

  it("refuses to boot in production with a placeholder secret (non-zero exit, clear message)", async () => {
    const proc = spawn({ ...validProd, JWT_SECRET: "change-me-to-a-long-random-string-at-least-32-chars", PORT: "39001" });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).not.toBe(0);
    expect(err).toContain("JWT_SECRET looks like a placeholder");
  });

  it("boots, serves probes, logs JSON, and exits 0 on SIGTERM (graceful shutdown)", async () => {
    const port = 30000 + Math.floor(Math.random() * 20000);
    const proc = spawn({ ...validProd, PORT: String(port) });
    try {
      // wait for it to come up
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
        if (!up) await Bun.sleep(100);
      }
      expect(up).toBe(true);
      expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(200);

      // The API sets Secure/None cookies in production; check over a real socket.
      const res = await fetch(`http://127.0.0.1:${port}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://tasks.example.com" },
        body: JSON.stringify({ name: "Proc Test", email: `proc-${Date.now()}@example.com`, password: "correct-horse-battery" }),
      });
      expect(res.status).toBe(201);
      const cookie = res.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=None");
      expect(res.headers.get("access-control-allow-origin")).toBe("https://tasks.example.com");
      expect(res.headers.get("strict-transport-security")).toBeTruthy();

      proc.kill("SIGTERM");
      const code = await Promise.race([proc.exited, Bun.sleep(8000).then(() => "timeout" as const)]);
      expect(code).toBe(0);

      const out = await new Response(proc.stdout).text();
      const lines = out.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>); // every line is valid JSON
      const msgs = lines.map((l) => l.msg);
      expect(msgs).toContain("api listening");
      expect(msgs).toContain("shutting down");
      expect(msgs).toContain("shutdown complete");
      const access = lines.find((l) => l.msg === "request" && l.path === "/auth/register")!;
      expect(access).toMatchObject({ method: "POST", status: 201 });
      expect(out).not.toContain("correct-horse-battery"); // bodies are never logged
      expect(out).not.toContain("accessToken");
    } finally {
      proc.kill("SIGKILL");
      await sql`delete from users where email like 'proc-%@example.com'`;
    }
  });
});
