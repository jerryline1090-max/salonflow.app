import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi } from "@/api/resources";
import { ApiError, getToken, setToken } from "@/api/client";
import { getSessionSnapshot } from "./sessionCache";
import type { User } from "@/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  bootstrapError: boolean;
  retryBootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { businessName: string; ownerName: string; email: string; password: string; phone: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState(false);

  const bootstrap = useCallback(async () => {
    const session = getSessionSnapshot();
    const token = getToken();
    if (!token) {
      setUser(null);
      setBootstrapError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setBootstrapError(false);
    try {
      setUser(await authApi.me());
    } catch (error) {
      if (session !== getSessionSnapshot()) return;
      setUser(null);
      if (error instanceof ApiError && error.status === 401) {
        // apiRequest already retires the session/cache on a current 401.
        if (getToken()) setToken(null);
      } else {
        // Keep a valid-looking stored session during a temporary outage. A
        // protected route remains blocked until /auth/me succeeds on retry.
        setBootstrapError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function login(email: string, password: string) {
    const { token } = await authApi.login(email, password);
    setToken(token);
    // The new session remounts AuthProvider and validates /auth/me behind the
    // existing bootstrap gate before any authenticated queries can render.
  }

  async function register(input: { businessName: string; ownerName: string; email: string; password: string; phone: string }) {
    const { token } = await authApi.register(input);
    setToken(token);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, bootstrapError, retryBootstrap: bootstrap, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
