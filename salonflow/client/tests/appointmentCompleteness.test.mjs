import { beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
globalThis.window = { location: { origin: "http://localhost", pathname: "/calendar" }, setTimeout, clearTimeout, addEventListener() {} };
const bundle = await build({
  stdin: { contents: `export { appointmentsApi, staffApi } from "./src/api/resources";
    export * from "./src/utils/completePages"; export * from "./src/utils/appointmentViews";
    export * from "./src/utils/businessCalendar"; export * from "./src/auth/sessionCache";
    export { QueryObserver } from "@tanstack/react-query";`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser",
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"', "process.env.NODE_ENV": '"test"' },
});
const { appointmentsApi, staffApi, completePages, summarizeDay, calendarColumns, calendarGridBounds,
  businessCalendarRange, setToken, getSessionSnapshot, QueryObserver } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const range = businessCalendarRange("2026-08-26", "Africa/Lagos");
const statuses = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];
const rows = count => Array.from({ length: count }, (_, i) => ({ id: `appointment_${i}`, staffId: "own_staff", staff: { id: "own_staff", name: "Assigned staff" }, service: { name: "Service" }, status: statuses[i % 5], startsAt: "2026-08-26T08:00:00Z", endsAt: "2026-08-26T09:00:00Z" }));
const response = (body, status = 200) => ({ status, ok: status === 200, json: async () => body });
const page = (items, current, limit, total) => ({ items, pagination: { page: current, limit, total, totalPages: Math.ceil(total / limit) } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  setToken("test-session");
  getSessionSnapshot().queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
  globalThis.fetch = async () => { throw new Error("Unexpected request"); };
});
after(() => setToken(null));

function serveAppointments(items) {
  const requests = [];
  globalThis.fetch = async raw => {
    const url = new URL(raw);
    assert.equal(url.pathname, "/api/appointments/calendar-range");
    assert.equal(url.searchParams.get("from"), range.from);
    assert.equal(url.searchParams.get("to"), range.to);
    assert.equal(url.searchParams.has("page"), false);
    assert.equal(url.searchParams.has("limit"), false);
    requests.push(url.pathname);
    return response(items);
  };
  return requests;
}

test("Dashboard counts all 30 appointments and every status from one snapshot response", async () => {
  const requests = serveAppointments(rows(30));
  const all = await appointmentsApi.range(range);
  const summary = summarizeDay(all);
  assert.equal(summary.count, 30);
  assert.equal(summary.upcoming.length, 12);
  assert.deepEqual(summary.trend.map(x => x.value), [6, 6, 6, 6, 6]);
  assert.deepEqual(requests, ["/api/appointments/calendar-range"]);
});

test("Calendar includes all 150 appointments in one bounded request, with no OFFSET/page loop", async () => {
  const requests = serveAppointments(rows(150));
  assert.equal((await appointmentsApi.range(range)).length, 150);
  assert.deepEqual(requests, ["/api/appointments/calendar-range"]);
  assert.equal(range.from, "2026-08-25T23:00:00.000Z");
});

test("range API failure rejects instead of returning any partial schedule", async () => {
  globalThis.fetch = async () => response({ error: "Temporary failure" }, 503);
  await assert.rejects(appointmentsApi.range(range), /Temporary failure/);
});

test("hard-cap overflow is an explicit error, never a truncated successful result", async () => {
  globalThis.fetch = async () => response({ code: "CALENDAR_RANGE_TOO_LARGE", error: "This range contains more than 1,000 appointments. Choose a smaller date range or contact support." }, 422);
  await assert.rejects(appointmentsApi.range(range), error => error.status === 422 && /1,000/.test(error.message));
});

test("query stays pending without partial/zero data until its snapshot response resolves", async () => {
  const last = deferred(), reached = deferred();
  globalThis.fetch = async () => {
    reached.resolve();
    await last.promise;
    return response(rows(150));
  };
  const observer = new QueryObserver(getSessionSnapshot().queryClient, { queryKey: ["appointments", "complete-range", range], queryFn: ({ signal }) => appointmentsApi.range(range, signal) });
  const done = deferred();
  const unsubscribe = observer.subscribe(result => { if (result.isSuccess) done.resolve(result); });
  await reached.promise;
  assert.equal(observer.getCurrentResult().isPending, true);
  assert.equal(observer.getCurrentResult().data, undefined);
  last.resolve();
  assert.equal((await done.promise).data.length, 150);
  unsubscribe();
});

test("empty day returns zero only after a successful complete request", async () => {
  const gate = deferred();
  globalThis.fetch = async () => { await gate.promise; return response([]); };
  let completed = false;
  const result = appointmentsApi.range(range).then(value => { completed = true; return value; });
  assert.equal(completed, false);
  gate.resolve();
  assert.equal(summarizeDay(await result).count, 0);
});

test("STAFF own calendar labels come from appointments without calling settings/staff/services", async () => {
  const calls = [];
  globalThis.fetch = async raw => {
    const path = new URL(raw).pathname;
    calls.push(path);
    if (path === "/api/appointments/calendar-context") return response({ timezone: "Africa/Lagos", workingHours: [], canCreate: false, canViewStaff: false });
    if (path === "/api/appointments/calendar-range") return response(rows(30));
    return response({ error: "Forbidden" }, 403);
  };
  const context = await appointmentsApi.calendarContext();
  const appointments = await appointmentsApi.range(range);
  assert.equal(context.canViewStaff, false);
  assert.deepEqual(calendarColumns(appointments).map(c => c.id), ["own_staff"]);
  assert.deepEqual(calls, ["/api/appointments/calendar-context", "/api/appointments/calendar-range"]);
});

test("optional OWNER/MANAGER directory uses all pages; historical/unlisted columns are preserved", async () => {
  const staff = Array.from({ length: 125 }, (_, i) => ({ id: `staff_${i}`, name: `Staff ${i}`, status: "ACTIVE" }));
  globalThis.fetch = async raw => {
    const url = new URL(raw);
    assert.equal(url.pathname, "/api/staff");
    const current = Number(url.searchParams.get("page"));
    return response(page(staff.slice((current - 1) * 100, current * 100), current, 100, 125));
  };
  const allStaff = await staffApi.calendar();
  assert.equal(allStaff.length, 125);
  assert.equal(calendarColumns(rows(1), allStaff).length, 126);
});

test("optional directory duplicate IDs produce only one column", async () => {
  const all = Array.from({ length: 125 }, (_, i) => ({ id: `staff_${i}` }));
  const result = await completePages(async current => current === 1 ? page(all.slice(0, 100), 1, 100, 125) : page([all[99], ...all.slice(100)], 2, 100, 125));
  assert.equal(result.length, 125);
  assert.equal(new Set(result.map(a => a.id)).size, 125);
});

test("optional directory detects empty/repeated pages and changing totals", async () => {
  for (const second of [page([], 2, 100, 150), page(rows(50), 2, 100, 150), page(rows(150).slice(100), 2, 100, 151)]) {
    await assert.rejects(completePages(async current => current === 1 ? page(rows(100), 1, 100, 150) : second));
  }
});

test("unbounded/invalid/all-history ranges make no request", async () => {
  for (const invalid of [{}, { from: "bad", to: "bad" }, { from: "2020-01-01", to: "2026-01-01" }]) {
    assert.throws(() => appointmentsApi.range(invalid), /valid appointment range/);
  }
});

test("React Query cancellation aborts the snapshot request", async () => {
  const reached = deferred(), controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    reached.resolve();
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  const pending = appointmentsApi.range(range, controller.signal);
  await reached.promise;
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(calls, 1);
});

test("session retirement discards the snapshot without issuing another request", async () => {
  const reached = deferred(), release = deferred();
  let calls = 0;
  globalThis.fetch = async () => { calls++; reached.resolve(); await release.promise; return response(rows(150)); };
  const pending = appointmentsApi.range(range);
  await reached.promise;
  setToken("replacement-session");
  release.resolve();
  await assert.rejects(pending, /Session changed/);
  assert.equal(calls, 1);
});

test("historical outside-hours and midnight appointments remain within the display grid", () => {
  const appointments = [
    { ...rows(1)[0], startsAt: "2026-08-26T05:00:00Z", endsAt: "2026-08-26T06:00:00Z" },
    { ...rows(1)[0], id: "late", startsAt: "2026-08-26T22:00:00Z", endsAt: "2026-08-26T23:00:00Z" },
  ];
  assert.deepEqual(calendarGridBounds(appointments, "2026-08-26", "Africa/Lagos", 540, 1080), { start: 360, end: 1440 });
  assert.equal(calendarColumns(appointments, [{ id: "own_staff", name: "Inactive", status: "INACTIVE" }]).length, 1);
});
