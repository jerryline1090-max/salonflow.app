import { assertValidTimezone, businessDayRange } from "../timezone";

describe("business timezone utilities", () => {
  it.each(["Africa/Lagos", "Europe/London", "America/New_York"])("accepts valid IANA timezone %s", (timezone) => {
    expect(() => assertValidTimezone(timezone)).not.toThrow();
  });

  it("rejects an arbitrary timezone string", () => {
    expect(() => assertValidTimezone("Not/A-Real-Timezone")).toThrow(/valid IANA/i);
  });

  it("uses the persisted timezone's DST-aware local-day boundaries", () => {
    const range = businessDayRange("America/New_York", 0, new Date("2026-03-08T16:00:00.000Z"));
    // On the US DST changeover date, New York midnight is 05:00Z while the
    // end of that shorter local day is 03:59:59.999Z the following day.
    expect(range.from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-03-09T03:59:59.999Z");
  });
});
