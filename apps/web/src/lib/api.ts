import type { Session } from "./types";

const BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Every non-2xx response from the API is `{ error, code }`; this is that, as an Error. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Access token: kept in MODULE MEMORY only — never localStorage — so an XSS bug can't lift it
// out of storage. The long-lived secret is the httpOnly refresh cookie, which JS can't read.
// ---------------------------------------------------------------------------
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

// ---------------------------------------------------------------------------
// Global hooks, registered once by the app shell.
// ---------------------------------------------------------------------------
let reportError: (error: ApiError) => void = () => {};
let onSessionExpired: () => void = () => {};

/** Where failures surface. The toast provider registers itself here so NO failed request is silent. */
export function setErrorReporter(fn: (error: ApiError) => void) {
  reportError = fn;
  return () => {
    reportError = () => {};
  };
}

/** Called when a refresh fails mid-session, so the app can return the user to the login page. */
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
  return () => {
    onSessionExpired = () => {};
  };
}

// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Don't toast on failure (the caller handles it). */
  silent?: boolean;
  /** Skip the Authorization header and the refresh-and-retry logic (login, register, logout). */
  auth?: boolean;
}

function send(path: string, { method = "GET", body, auth = true }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  // `fetch` is looked up at call time (not captured at import) so tests can stub it.
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include", // send/receive the httpOnly refresh cookie cross-origin
  });
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as { error?: string; code?: string; details?: unknown };
    return new ApiError(res.status, data.code ?? "UNKNOWN", data.error ?? `Request failed (${res.status})`, data.details);
  } catch {
    return new ApiError(res.status, "UNKNOWN", `Request failed (${res.status})`);
  }
}

const networkError = () =>
  new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");

// ---------------------------------------------------------------------------
// Refresh, single-flight: if five requests all hit an expired token at once, exactly ONE
// POST /auth/refresh is made and all five wait for its result. (Refresh tokens rotate, so
// firing several in parallel would make all but one fail.)
// ---------------------------------------------------------------------------
let refreshInFlight: Promise<Session | null> | null = null;

export function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await send("/auth/refresh", { method: "POST", auth: false });
      if (!res.ok) {
        setAccessToken(null);
        return null; // no cookie / expired / revoked — perfectly normal on first visit
      }
      const session = (await res.json()) as Session;
      setAccessToken(session.accessToken);
      return session;
    } catch {
      reportError(networkError());
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * The one fetch wrapper the whole SPA uses.
 *  - attaches the bearer token
 *  - on a 401, silently refreshes the session once and retries (this is the fix for
 *    "random logouts" caused by a JWT expiring mid-session)
 *  - turns every remaining non-2xx response into an ApiError AND reports it (a toast)
 */
export async function api<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const { silent = false, auth = true } = options;

  let res: Response;
  try {
    res = await send(path, options);
  } catch {
    const err = networkError();
    if (!silent) reportError(err);
    throw err;
  }

  if (res.status === 401 && auth) {
    const session = await refreshSession();
    if (session) {
      try {
        res = await send(path, options); // retry once with the fresh token
      } catch {
        const err = networkError();
        if (!silent) reportError(err);
        throw err;
      }
    } else {
      const err = new ApiError(401, "SESSION_EXPIRED", "Your session has expired. Please log in again.");
      if (!silent) reportError(err);
      onSessionExpired();
      throw err;
    }
  }

  if (!res.ok) {
    const err = await toApiError(res);
    if (!silent) reportError(err);
    throw err;
  }

  return (res.status === 204 ? undefined : await res.json()) as T;
}
