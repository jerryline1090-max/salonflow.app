import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi } from "@/api/resources";
import { getToken, setToken } from "@/api/client";
import type { User } from "@/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { businessName: string; ownerName: string; email: string; password: string; phone: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const { token } = await authApi.login(email, password);
    setToken(token);
    setUser(await authApi.me());
  }

  async function register(input: { businessName: string; ownerName: string; email: string; password: string; phone: string }) {
    const { token } = await authApi.register(input);
    setToken(token);
    setUser(await authApi.me());
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
