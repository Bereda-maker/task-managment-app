import { describe, expect, it, vi } from "vitest";
import { ApiError, api, getAccessToken, setAccessToken, setErrorReporter, setSessionExpiredHandler } from "./api";
import { apiError, mockApi, respond } from "../test/utils";

describe("api() fetch wrapper", () => {
  it("sends the in-memory access token as a Bearer header and includes credentials", async () => {
    setAccessToken("abc");
    const { calls, fetchMock } = mockApi({ "GET /boards": () => respond({ boards: [] }) });

    await api("/boards");

    expect(calls[0]!.auth).toBe("Bearer abc");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("refreshes an expired token once and retries the original request (no random logouts)", async () => {
    setAccessToken("stale");
    let boardsCalls = 0;
    const { calls } = mockApi({
      "GET /boards": () => (++boardsCalls === 1 ? apiError(401, "TOKEN_EXPIRED", "Access token expired") : respond({ boards: [] })),
      "POST /auth/refresh": () => respond({ user: { id: "u", name: "U", email: "u@x.io" }, accessToken: "fresh" }),
    });
    const reporter = vi.fn();
    setErrorReporter(reporter);

    const data = await api<{ boards: unknown[] }>("/boards");

    expect(data).toEqual({ boards: [] });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /boards", "POST /auth/refresh", "GET /boards"]);
    expect(calls[2]!.auth).toBe("Bearer fresh");
    expect(getAccessToken()).toBe("fresh");
    expect(reporter).not.toHaveBeenCalled(); // the user never sees a hiccup
  });

  it("makes ONE refresh call when many requests expire at the same time", async () => {
    setAccessToken("stale");
    const { callsTo } = mockApi({
      "GET /boards": ({ auth }) => (auth === "Bearer stale" ? apiError(401, "TOKEN_EXPIRED", "expired") : respond({ boards: [] })),
      "POST /auth/refresh": async () => {
        await new Promise((r) => setTimeout(r, 20));
        return respond({ user: { id: "u", name: "U", email: "u@x.io" }, accessToken: "fresh" });
      },
    });

    await Promise.all([api("/boards"), api("/boards"), api("/boards"), api("/boards"), api("/boards")]);

    expect(callsTo("POST /auth/refresh")).toHaveLength(1);
  });

  it("signs the user out (once, with one toast) when the refresh fails", async () => {
    setAccessToken("stale");
    mockApi({
      "GET /boards": () => apiError(401, "TOKEN_EXPIRED", "expired"),
      "POST /auth/refresh": () => apiError(401, "INVALID_REFRESH_TOKEN", "Session expired."),
    });
    const reporter = vi.fn();
    const expired = vi.fn();
    setErrorReporter(reporter);
    setSessionExpiredHandler(expired);

    await expect(api("/boards")).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });

    expect(expired).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it("does not try to refresh when a login attempt is rejected", async () => {
    const { callsTo } = mockApi({
      "POST /auth/login": () => apiError(401, "INVALID_CREDENTIALS", "Invalid email or password"),
    });
    const reporter = vi.fn();
    setErrorReporter(reporter);

    await expect(api("/auth/login", { method: "POST", body: {}, auth: false })).rejects.toBeInstanceOf(ApiError);

    expect(callsTo("POST /auth/refresh")).toHaveLength(0);
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid email or password" }));
  });

  it("reports every non-2xx response, using the API's own message — nothing fails silently", async () => {
    mockApi({ "PATCH /tasks/x": () => apiError(403, "FORBIDDEN", "You are not a member of this board") });
    const reporter = vi.fn();
    setErrorReporter(reporter);

    await expect(api("/tasks/x", { method: "PATCH", body: { status: "done" } })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({ message: "You are not a member of this board" }));
  });

  it("lets callers opt out of the toast with { silent: true }", async () => {
    mockApi({ "GET /x": () => apiError(404, "NOT_FOUND", "nope") });
    const reporter = vi.fn();
    setErrorReporter(reporter);

    await expect(api("/x", { silent: true })).rejects.toBeInstanceOf(ApiError);
    expect(reporter).not.toHaveBeenCalled();
  });

  it("reports network failures as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const reporter = vi.fn();
    setErrorReporter(reporter);

    await expect(api("/boards")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for 204 No Content", async () => {
    mockApi({ "DELETE /tasks/1": () => respond(null, 204) });
    await expect(api("/tasks/1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
