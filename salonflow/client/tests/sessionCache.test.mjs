// node --test tests/sessionCache.test.mjs
// Uses Node's built-in runner and Vite's existing esbuild; no browser/network.
import { beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const values = new Map();
const storageListeners = [];
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  location: { origin: "http://localhost", pathname: "/login", href: "/login" },
  setTimeout, clearTimeout,
  addEventListener: (event, listener) => { if (event === "storage") storageListeners.push(listener); },
};
const bundled = await build({
  stdin: {
    contents: 'export * from "./src/auth/sessionCache"; export { apiRequest } from "./src/api/client"; export { MutationObserver } from "@tanstack/react-query";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"', "process.env.NODE_ENV": '"test"' },
});
const { setToken, getToken, getSessionSnapshot, apiRequest, subscribeSession, MutationObserver } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

// Browser query GC timers are unnecessary in this short-lived Node harness,
// including cancelled queries that settle after removal from their old cache.
const stopTestDefaults = subscribeSession(() => {
  getSessionSnapshot().queryClient.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity },
    mutations: { gcTime: Infinity },
  });
});

const keys = ["clients", "settings", "subscription", "billing-history", "appointments", "reports", "notifications", "staff", "services"];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
beforeEach(() => {
  setToken("fixture-session-A");
  globalThis.fetch = async () => { throw new Error("Unexpected request in test"); };
});
after(() => { setToken(null); stopTestDefaults(); });

test("logout synchronously clears every authenticated key and token, and publishes a fresh boundary", () => {
  const old = getSessionSnapshot();
  for (const key of keys) old.queryClient.setQueryData([key], { businessId: "A" });
  let observed;
  const unsubscribe = subscribeSession(() => { observed = getSessionSnapshot(); });
  setToken(null);
  unsubscribe();
  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem("salonflow.token"), null);
  assert.equal(old.queryClient.getQueryCache().getAll().length, 0);
  assert.equal(observed, getSessionSnapshot());
  assert.notEqual(observed.revision, old.revision);
});

for (const key of keys) {
  test(`${key}: logout/login and direct account/business replacement cannot reuse A data`, () => {
    const a = getSessionSnapshot().queryClient;
    a.setQueryData([key], { businessId: "A" });
    setToken(null);
    setToken("fixture-session-B");
    const b = getSessionSnapshot().queryClient;
    assert.notEqual(a, b);
    assert.equal(b.getQueryData([key]), undefined);
    b.setQueryData([key], { businessId: "B" });
    setToken("fixture-session-C");
    assert.equal(getSessionSnapshot().queryClient.getQueryData([key]), undefined);
  });
}

test("current /auth/me 401 clears both token and authenticated cache", async () => {
  const old = getSessionSnapshot();
  old.queryClient.setQueryData(["settings"], { businessId: "A" });
  globalThis.fetch = async () => response(401, {});
  await assert.rejects(apiRequest("/auth/me"), { status: 401 });
  assert.equal(getToken(), null);
  assert.equal(old.queryClient.getQueryCache().getAll().length, 0);
  assert.notEqual(old, getSessionSnapshot());
});

test("temporary /auth/me 503 preserves token, session generation and cached data", async () => {
  const old = getSessionSnapshot();
  old.queryClient.setQueryData(["settings"], { businessId: "A" });
  globalThis.fetch = async () => response(503, { error: "Unavailable" });
  await assert.rejects(apiRequest("/auth/me"), { status: 503 });
  assert.equal(getToken(), "fixture-session-A");
  assert.equal(getSessionSnapshot(), old);
  assert.deepEqual(old.queryClient.getQueryData(["settings"]), { businessId: "A" });
});

test("logout aborts active transport; even an abort-ignoring late query cannot refill B cache", async () => {
  const pending = deferred();
  let signal;
  globalThis.fetch = async (_url, options) => { signal = options.signal; return pending.promise; };
  const old = getSessionSnapshot();
  const query = old.queryClient.fetchQuery({ queryKey: ["clients"], queryFn: () => apiRequest("/clients") });
  const rejected = assert.rejects(query);
  setToken(null);
  setToken("fixture-session-B");
  assert.equal(signal.aborted, true);
  pending.resolve(response(200, [{ businessId: "A" }]));
  await rejected;
  assert.equal(old.queryClient.getQueryCache().getAll().length, 0);
  assert.equal(getSessionSnapshot().queryClient.getQueryData(["clients"]), undefined);
});

test("old session 401 cannot clear B's token/cache", async () => {
  const pending = deferred();
  globalThis.fetch = () => pending.promise;
  const request = apiRequest("/auth/me");
  setToken("fixture-session-B");
  const b = getSessionSnapshot();
  b.queryClient.setQueryData(["settings"], "B");
  pending.resolve(response(401, {}));
  await assert.rejects(request, { status: 409 });
  assert.equal(getToken(), "fixture-session-B");
  assert.equal(b.queryClient.getQueryData(["settings"]), "B");
});

test("session switch while reading a response body discards the old result", async () => {
  const body = deferred();
  globalThis.fetch = async () => ({ ...response(200, {}), json: () => body.promise });
  const request = apiRequest("/settings");
  await Promise.resolve();
  setToken("fixture-session-B");
  body.resolve({ businessId: "A" });
  await assert.rejects(request, { status: 409 });
});

test("in-flight mutation cannot run stale success/redirect or invalidate B's queries", async () => {
  const pending = deferred();
  const started = deferred();
  globalThis.fetch = () => { started.resolve(); return pending.promise; };
  const old = getSessionSnapshot().queryClient;
  let successes = 0;
  const mutation = old.getMutationCache().build(old, {
    gcTime: Infinity, // Retired mutation must not leave a browser GC timer in Node.
    mutationFn: () => apiRequest("/fixture-write", { method: "POST" }),
    onSuccess: () => { successes++; old.setQueryData(["settings"], "stale A"); },
    onSettled: () => old.invalidateQueries({ queryKey: ["settings"] }),
  });
  const result = mutation.execute();
  await started.promise;
  setToken("fixture-session-B");
  const b = getSessionSnapshot().queryClient;
  b.setQueryData(["settings"], "B");
  pending.resolve(response(200, { businessId: "A" }));
  await assert.rejects(result, { status: 409 });
  assert.equal(successes, 0);
  assert.equal(b.getQueryData(["settings"]), "B");
  assert.equal(b.getQueryState(["settings"]).isInvalidated, false);
});

test("cross-tab token change retires local cache; unrelated storage changes do not", () => {
  const old = getSessionSnapshot();
  old.queryClient.setQueryData(["clients"], "A");
  for (const listener of storageListeners) listener({ storageArea: localStorage, key: "unrelated" });
  assert.equal(getSessionSnapshot(), old);
  localStorage.setItem("salonflow.token", "fixture-other-tab-B");
  for (const listener of storageListeners) listener({ storageArea: localStorage, key: "salonflow.token" });
  assert.equal(getToken(), "fixture-other-tab-B");
  assert.notEqual(getSessionSnapshot(), old);
  assert.equal(old.queryClient.getQueryCache().getAll().length, 0);
});

test("mutation queued before logout cannot start using the next user's token", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return response(200, {}); };
  const old = getSessionSnapshot().queryClient;
  const mutation = old.getMutationCache().build(old, {
    mutationFn: () => apiRequest("/fixture-write", { method: "POST" }),
  });
  const pending = mutation.execute();
  setToken("fixture-session-B");
  await assert.rejects(pending, /Session changed/);
  assert.equal(requests, 0);
});

test("retired mutation success callback is suppressed even if its result was already resolved", async () => {
  let successes = 0;
  const started = deferred();
  const old = getSessionSnapshot().queryClient;
  const mutation = old.getMutationCache().build(old, {
    mutationFn: async () => { started.resolve(); return "A"; },
    onSuccess: () => { successes++; },
  });
  const pending = mutation.execute();
  await started.promise;
  setToken("fixture-session-B");
  await pending;
  assert.equal(successes, 0);
});

test("chained mutateAsync continuation cannot create a follow-up request after A retires", async () => {
  const a = getSessionSnapshot().queryClient;
  const firstCompleted = deferred();
  const resume = deferred();
  let secondCalls = 0;
  let requests = 0;
  let tokenObserved;
  globalThis.fetch = async () => { requests++; return response(200, {}); };
  const first = new MutationObserver(a, { mutationFn: async () => ({ id: "A-client" }) });
  const second = new MutationObserver(a, {
    mutationFn: () => {
      secondCalls++;
      tokenObserved = getToken();
      return apiRequest("/fixture-followup", { method: "POST" });
    },
    onSettled: () => a.invalidateQueries({ queryKey: ["settings"] }),
  });
  const chain = (async () => {
    const created = await first.mutate();
    firstCompleted.resolve();
    await resume.promise; // Deterministic switch before the captured second mutateAsync.
    return second.mutate({ clientId: created.id });
  })();
  await firstCompleted.promise;
  setToken(null);
  setToken("fixture-session-B");
  const b = getSessionSnapshot().queryClient;
  b.setQueryData(["settings"], "B");
  const rejected = assert.rejects(chain, { name: "RetiredSessionError" });
  resume.resolve();
  await rejected;
  assert.equal(secondCalls, 0);
  assert.equal(requests, 0);
  assert.equal(tokenObserved, undefined);
  assert.equal(b.getQueryData(["settings"]), "B");
  assert.equal(b.getQueryState(["settings"]).isInvalidated, false);
  assert.equal(getToken(), "fixture-session-B");
  a.clear();
});

for (const mode of ["logout", "account switch", "cross-tab switch"]) {
  test(`new mutation from old observer after ${mode} is rejected before mutationFn`, async () => {
    const a = getSessionSnapshot().queryClient;
    let calls = 0;
    let errors = 0;
    const old = new MutationObserver(a, {
      mutationFn: () => { calls++; return apiRequest("/fixture-write", { method: "POST" }); },
      onError: () => { errors++; },
      onSettled: () => a.invalidateQueries({ queryKey: ["clients"] }),
    });
    if (mode === "cross-tab switch") {
      localStorage.setItem("salonflow.token", "fixture-session-B");
      for (const listener of storageListeners) listener({ storageArea: localStorage, key: "salonflow.token" });
    } else setToken(mode === "logout" ? null : "fixture-session-B");
    const current = getSessionSnapshot();
    const token = getToken();
    current.queryClient.setQueryData(["clients"], "current");
    await assert.rejects(old.mutate(), { name: "RetiredSessionError" });
    assert.equal(calls, 0);
    assert.equal(errors, 1); // Framework error callbacks still run on local rejection.
    assert.equal(getSessionSnapshot(), current);
    assert.equal(getToken(), token);
    assert.equal(current.queryClient.getQueryData(["clients"]), "current");
    assert.equal(current.queryClient.getQueryState(["clients"]).isInvalidated, false);
    a.clear();
  });
}

test("active B mutation retains B credentials and normal success/error callbacks", async () => {
  setToken("fixture-session-B");
  const b = getSessionSnapshot().queryClient;
  let successes = 0;
  let errors = 0;
  let settled = 0;
  let status = 200;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture-session-B");
    return response(status, status === 200 ? { ok: true } : { error: "Fixture validation error" });
  };
  const active = new MutationObserver(b, {
    mutationFn: () => apiRequest("/fixture-write", { method: "POST" }),
    onSuccess: () => { successes++; },
    onError: () => { errors++; },
    onSettled: () => { settled++; },
  });
  assert.deepEqual(await active.mutate(), { ok: true });
  status = 400;
  await assert.rejects(active.mutate(), { status: 400 });
  assert.equal(successes, 1);
  assert.equal(errors, 1);
  assert.equal(settled, 2);
  assert.equal(getToken(), "fixture-session-B");
});

test("retirement flag is set before abort, cache removal and token replacement", () => {
  const old = getSessionSnapshot();
  let observed = false;
  old.controller.signal.addEventListener("abort", () => {
    observed = true;
    assert.equal(old.lifecycle.retired, true);
    assert.equal(getToken(), "fixture-session-A");
  });
  old.queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "removed") assert.equal(old.lifecycle.retired, true);
  });
  old.queryClient.setQueryData(["settings"], "A");
  setToken("fixture-session-B");
  assert.equal(observed, true);
  assert.equal(getSessionSnapshot().lifecycle.retired, false);
});

test("mutation that passed global gate but awaits option onMutate is fenced at retirement", async () => {
  const entered = deferred();
  const resume = deferred();
  let calls = 0;
  const old = getSessionSnapshot().queryClient;
  const observer = new MutationObserver(old, {
    onMutate: async () => { entered.resolve(); await resume.promise; },
    mutationFn: async () => { calls++; return getToken(); },
  });
  const pending = observer.mutate();
  await entered.promise;
  setToken("fixture-session-B");
  const rejected = assert.rejects(pending, { name: "RetiredSessionError" });
  resume.resolve();
  await rejected;
  assert.equal(calls, 0);
  assert.equal(getToken(), "fixture-session-B");
});
