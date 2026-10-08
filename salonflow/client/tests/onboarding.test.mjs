// node --test tests/onboarding.test.mjs — local mocks only, no new test framework.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  stdin: { contents: 'export * from "./src/onboardingWorkflow"; export * from "./src/onboardingRouting";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { onboardingServiceInput, createOnboardingSubmitLock, completeOnboardingAndRefresh, requiresOnboarding } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const [naira, kobo] of [["1", 100], ["10000", 1000000], ["15000", 1500000], ["0.29", 29], ["0", 0]]) {
  test(`${naira} naira is submitted as ${kobo} kobo`, () => {
    assert.deepEqual(onboardingServiceInput({ name: " Cut ", price: naira, durationMinutes: "30" }), { name: "Cut", price: kobo, durationMinutes: 30 });
  });
}
for (const price of ["", "-1", "1.001", "NaN", "Infinity", "1e4", "900719925474099100"]) {
  test(`invalid monetary input ${JSON.stringify(price)} is rejected, not rounded`, () => {
    assert.throws(() => onboardingServiceInput({ name: "Cut", price, durationMinutes: "30" }));
  });
}
test("invalid name and duration do not reach service creation", () => {
  for (const form of [{ name: "", durationMinutes: "30" }, { name: "Cut", durationMinutes: "0" }, { name: "Cut", durationMinutes: "1.5" }]) {
    assert.throws(() => onboardingServiceInput({ ...form, price: "1" }));
  }
});
test("completion awaits authoritative auth refresh; guard allows dashboard only once COMPLETED", async () => {
  const refresh = deferred();
  const calls = [];
  const owner = { role: "OWNER", onboarding: { onboardingStatus: "IN_PROGRESS" } };
  const pending = completeOnboardingAndRefresh(async () => { calls.push("complete"); }, async () => {
    calls.push("auth/me"); await refresh.promise; owner.onboarding.onboardingStatus = "COMPLETED";
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["complete", "auth/me"]);
  assert.equal(requiresOnboarding(owner), true);
  refresh.resolve(); await pending;
  assert.equal(requiresOnboarding(owner), false);
});
test("failed completion never refreshes auth or fabricates completed state", async () => {
  let refreshes = 0;
  await assert.rejects(completeOnboardingAndRefresh(async () => { throw new Error("save failed"); }, async () => { refreshes++; }), /save failed/);
  assert.equal(refreshes, 0);
});
test("temporary auth refresh failure has no optimistic completion or navigation fallback", async () => {
  let completed = false;
  let retries = 0;
  const refresh = async () => { retries++; if (retries === 1) throw new Error("temporary 503"); };
  await assert.rejects(completeOnboardingAndRefresh(async () => { completed = true; }, refresh), /503/);
  assert.equal(completed, true); // Persisted server completion is not undone.
  await refresh(); // Existing AuthContext retry does not repeat completion.
  assert.equal(retries, 2);
});
for (const action of ["first service", "business hours", "completion"]) {
  test(`${action} duplicate submissions share a synchronous lock`, async () => {
    const run = createOnboardingSubmitLock(); const held = deferred(); let calls = 0;
    const task = async () => { calls++; await held.promise; };
    const first = run(task); await run(task);
    assert.equal(calls, 1);
    held.resolve(); await first;
  });
}
test("failed submission releases lock so the owner can retry", async () => {
  const run = createOnboardingSubmitLock(); let attempts = 0;
  await assert.rejects(run(async () => { attempts++; throw new Error("failed"); }), /failed/);
  await run(async () => { attempts++; });
  assert.equal(attempts, 2);
});
for (const role of ["OWNER", "MANAGER", "STAFF"]) {
  test(`${role} routing preserves existing onboarding policy`, () => {
    assert.equal(requiresOnboarding({ role, onboarding: { onboardingStatus: "IN_PROGRESS" } }), role === "OWNER");
    assert.equal(requiresOnboarding({ role, onboarding: { onboardingStatus: "COMPLETED" } }), false);
  });
}
