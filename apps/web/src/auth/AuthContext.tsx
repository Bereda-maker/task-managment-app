import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from "../lib/api";
import type { LoginValues, RegisterValues } from "../lib/schemas";
import type { Session, User } from "../lib/types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthApi {
  status: Status;
  user: User | null;
  login: (values: LoginValues) => Promise<void>;
  register: (values: RegisterValues) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
    qc.clear(); // never leave one person's data in the cache for the next login
  }, [qc]);

  // "Stay logged in across a browser restart": the access token lives only in memory, so on
  // every page load we ask the API to trade the httpOnly refresh cookie for a new one.
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((session) => {
      if (cancelled) return;
      if (session) {
        setUser(session.user);
        setStatus("authenticated");
      } else {
        setStatus("anonymous");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // If a refresh fails mid-session (revoked / expired), drop back to the login page.
  useEffect(() => setSessionExpiredHandler(clearSession), [clearSession]);

  const startSession = useCallback((session: Session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback(
    async (values: LoginValues) => {
      startSession(await api<Session>("/auth/login", { method: "POST", body: values, auth: false }));
    },
    [startSession],
  );

  const register = useCallback(
    async (values: RegisterValues) => {
      startSession(await api<Session>("/auth/register", { method: "POST", body: values, auth: false }));
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", auth: false, silent: true });
    } catch {
      /* even if the server is unreachable, sign out locally */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(() => ({ status, user, login, register, logout }), [status, user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
