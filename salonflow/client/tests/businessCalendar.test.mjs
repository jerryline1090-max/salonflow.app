import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const result = await build({ stdin: { contents: 'export * from "./src/utils/businessCalendar";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, format: "esm", platform: "browser" });
const { businessDateKey, businessCalendarRange, businessWallTime, businessMinutes, shiftBusinessDate } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
test("Lagos day query does not depend on browser timezone", () => {
  assert.deepEqual(businessCalendarRange("2026-08-26", "Africa/Lagos"), { from: "2026-08-25T23:00:00.000Z", to: "2026-08-26T22:59:59.999Z" });
  assert.equal(businessWallTime("2026-08-26", 540, "Africa/Lagos").toISOString(), "2026-08-26T08:00:00.000Z");
  assert.equal(businessMinutes("2026-08-26T08:00:00Z", "Africa/Lagos"), 540);
});
test("New York DST day has correct 23-hour range", () => {
  const range = businessCalendarRange("2026-03-08", "America/New_York");
  assert.equal(+new Date(range.to) + 1 - +new Date(range.from), 23 * 3600_000);
  assert.throws(() => businessWallTime("2026-03-08", 150, "America/New_York"));
});
test("today and calendar shifts use business date", () => {
  assert.equal(businessDateKey(new Date("2026-08-25T23:30:00Z"), "Africa/Lagos"), "2026-08-26");
  assert.equal(shiftBusinessDate("2026-12-31", 1), "2027-01-01");
});
