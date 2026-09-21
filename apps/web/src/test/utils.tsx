import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import App from "../App";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";

export const respond = (body: unknown, status = 200) =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const apiError = (status: number, code: string, error: string) => respond({ error, code }, status);

export interface RecordedCall {
  method: string;
  path: string;
  search: string;
  body: any;
  auth: string | null;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/**
 * Replaces global fetch with an in-memory fake API, keyed by "METHOD /path". This is the
 * "mocked fetch layer" the frontend tests use — no real backend involved.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const call: RecordedCall = {
      method,
      path: url.pathname,
      search: url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("Authorization"),
    };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return apiError(500, "UNMOCKED", `No mock for ${method} ${url.pathname}`);
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, callsTo: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key) };
}

export function renderApp(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// ---------- Fixtures ----------
export const alice = { id: "11111111-1111-4111-8111-111111111111", name: "Alice Adams", email: "alice@example.com" };
export const bob = { id: "22222222-2222-4222-8222-222222222222", name: "Bob Brown", email: "bob@example.com" };
export const session = { user: alice, accessToken: "token-1" };

export const boardDetail = {
  id: "b1",
  name: "Launch plan",
  ownerId: alice.id,
  createdAt: "2026-01-01T00:00:00Z",
  role: "owner",
  members: [
    { ...alice, role: "owner" },
    { ...bob, role: "member" },
  ],
};

export function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    boardId: "b1",
    title: "Write docs",
    status: "todo",
    assigneeId: bob.id,
    dueDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    assignee: bob,
    ...overrides,
  };
}
