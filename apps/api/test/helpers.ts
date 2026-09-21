import { app } from "../src/app";
import { sql } from "../src/db/client";

let ipCounter = 0;

interface ReqOptions {
  token?: string;
  body?: unknown;
  /** Send this string verbatim as the body (for malformed-JSON tests). */
  rawBody?: string;
  headers?: Record<string, string>;
  cookie?: string;
  /** Simulated client IP. Defaults to a fresh one per request so tests never trip the rate limiter. */
  ip?: string;
}

export async function api(method: string, path: string, opts: ReqOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
    ...opts.headers,
  };
  if (opts.body !== undefined || opts.rawBody !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;

  return app.request(path, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
}

export async function resetDb() {
  // CASCADE from users reaches every table through the foreign keys.
  await sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`;
}

/** Extracts `refresh_token=<value>` from a response's Set-Cookie header, ready to send back. */
export function refreshCookieFrom(res: Response): string | null {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith("refresh_token="));
  if (!raw) return null;
  const pair = raw.split(";")[0]!;
  return pair === "refresh_token=" ? null : pair; // an empty value means "cleared"
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
  cookie: string;
}

let userCounter = 0;
export async function registerUser(name = "Test User", email?: string): Promise<TestUser> {
  const address = email ?? `user${++userCounter}-${Date.now()}@example.com`;
  const res = await api("POST", "/auth/register", {
    body: { name, email: address, password: "correct-horse-battery" },
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { user: { id: string; name: string; email: string }; accessToken: string };
  return { ...data.user, token: data.accessToken, cookie: refreshCookieFrom(res)! };
}

export async function createBoard(user: TestUser, name = "Sprint board") {
  const res = await api("POST", "/boards", { token: user.token, body: { name } });
  if (res.status !== 201) throw new Error(`create board failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; name: string; ownerId: string; role: string };
}

export async function addMember(owner: TestUser, boardId: string, member: TestUser) {
  const res = await api("POST", `/boards/${boardId}/members`, { token: owner.token, body: { email: member.email } });
  if (res.status !== 201) throw new Error(`add member failed: ${res.status} ${await res.text()}`);
}

export async function createTask(user: TestUser, boardId: string, body: Record<string, unknown>) {
  const res = await api("POST", `/boards/${boardId}/tasks`, { token: user.token, body });
  if (res.status !== 201) throw new Error(`create task failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    id: string;
    title: string;
    status: string;
    assigneeId: string | null;
    dueDate: string | null;
    assignee: { id: string; name: string; email: string } | null;
  };
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
