import { MutationCache, QueryClient } from "@tanstack/react-query";

const TOKEN_STORAGE_KEY = "salonflow.token";
const listeners = new Set<() => void>();

class RetiredSessionError extends Error {
  constructor() {
    super("Session changed — mutation discarded");
    this.name = "RetiredSessionError";
  }
}

function createSession(revision: number) {
  const lifecycle = { retired: false };
  return {
    revision,
    lifecycle,
    controller: new AbortController(),
    queryClient: new QueryClient({
      mutationCache: new MutationCache({
        // Global onMutate runs before mutationFn, including mutations created
        // later by a captured observer/async continuation from this session.
        onMutate: () => {
          if (lifecycle.retired) throw new RetiredSessionError();
        },
      }),
      defaultOptions: {
        queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
      },
    }),
  };
}

let session = createSession(0);
let sessionToken = localStorage.getItem(TOKEN_STORAGE_KEY);

export function getToken(): string | null {
  return sessionToken;
}

export const getSessionSnapshot = () => session;
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function replaceSession(token: string | null, persist: boolean) {
  session.lifecycle.retired = true;
  // Retire A before publishing B. Late mutation callbacks retain A's client,
  // never B's; remounting the subtree also discards observer/local UI state.
  // clear() alone does not stop a pending/paused mutation. Fence its function
  // before it can start with B's token, and suppress retired UI callbacks.
  for (const mutation of session.queryClient.getMutationCache().getAll()) {
    mutation.setOptions({
      ...mutation.options,
      mutationFn: () => Promise.reject(new RetiredSessionError()),
      onMutate: undefined,
      onSuccess: undefined,
      onError: undefined,
      onSettled: undefined,
      retry: false,
    });
  }
  session.controller.abort();
  void session.queryClient.cancelQueries();
  session.queryClient.clear();
  if (persist) {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
  sessionToken = token;
  session = createSession(session.revision + 1);
  listeners.forEach((listener) => listener());
}

export function setToken(token: string | null) {
  replaceSession(token, true);
}

// A login/logout in another tab is also a session boundary, not just a new
// Authorization header on requests made by the old user's mounted screens.
window.addEventListener("storage", (event) => {
  if (event.storageArea !== localStorage || (event.key !== null && event.key !== TOKEN_STORAGE_KEY)) return;
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token !== sessionToken) replaceSession(token, false);
});
