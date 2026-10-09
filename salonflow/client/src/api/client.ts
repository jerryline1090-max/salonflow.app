import type { ApiErrorBody } from "@/types";
import { getSessionSnapshot, getToken, setToken } from "@/auth/sessionCache";
export { getToken, setToken } from "@/auth/sessionCache";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiUnavailableError extends ApiError {
  constructor(public readonly reason: "network" | "timeout") {
    super("SalonFlow is temporarily unavailable. Please try again shortly.", 503);
    this.name = "ApiUnavailableError";
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(API_BASE + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }
  // Keep an explicitly configured production API origin. Returning only the
  // path silently sent app.salonflow.com requests back to the frontend.
  return url.toString();
}

/**
 * Every API call in the app goes through this one function. It's what
 * makes "logout on an expired/invalid token" and "surface the backend's
 * actual error message" consistent everywhere, instead of each page
 * reimplementing fetch + error handling slightly differently.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = getSessionSnapshot();
  const token = getToken();
  const controller = new AbortController();
  const abort = () => controller.abort();
  session.controller.signal.addEventListener("abort", abort, { once: true });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const assertCurrentSession = () => {
    if (session !== getSessionSnapshot()) throw new ApiError("Session changed — request discarded", 409);
  };
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    options.signal?.throwIfAborted();
    let res: Response;
    try {
      res = await fetch(buildUrl(path, options.query), {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      assertCurrentSession();
      options.signal?.throwIfAborted();
      if (controller.signal.aborted) throw new ApiUnavailableError("timeout");
      throw new ApiUnavailableError("network");
    }
    // In particular, an old A-session 401 must not log out the new B session.
    assertCurrentSession();
    options.signal?.throwIfAborted();

    if (res.status === 401) {
      setToken(null);
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
      throw new ApiError("Session expired — please sign in again", 401);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const data = await res.json().catch(() => ({}) as ApiErrorBody);
    assertCurrentSession();
    options.signal?.throwIfAborted();

    if (!res.ok) {
      throw new ApiError((data as ApiErrorBody).error ?? "Something went wrong", res.status);
    }

    return data as T;
  } finally {
    window.clearTimeout(timeout);
    session.controller.signal.removeEventListener("abort", abort);
    options.signal?.removeEventListener("abort", abort);
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) => apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
