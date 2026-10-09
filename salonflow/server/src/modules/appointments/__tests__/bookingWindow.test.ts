import { bookingWindowReason, businessWeekday, operatingWindow } from "../bookingWindow";

describe.each(["Africa/Lagos", "America/New_York"])("business clock %s", (timezone) => {
  it("uses business weekday rather than runtime day", () => {
    expect(businessWeekday(new Date("2026-08-26T00:30:00Z"), timezone)).toBe(timezone === "Africa/Lagos" ? 3 : 2);
  });
  it("resolves exact open/close boundaries and rejects overnight hours", () => {
    const w = operatingWindow(new Date("2026-08-26T12:00:00Z"), timezone, "09:00", "18:00")!;
    expect(w.startsAt.toISOString()).toBe(timezone === "Africa/Lagos" ? "2026-08-26T08:00:00.000Z" : "2026-08-26T13:00:00.000Z");
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(9 * 3600_000);
    expect(operatingWindow(w.startsAt, timezone, "18:00", "09:00")).toBeNull();
  });
  it("allows notice equality and includes the full Nth business-local day", () => {
    const now = new Date("2026-08-26T12:00:00Z");
    const business = { timezone, minBookingNoticeMins: 120, maxBookingHorizonDays: 1 };
    expect(bookingWindowReason(business, new Date("2026-08-26T13:59:59.999Z"), now)).toMatch(/notice/);
    expect(bookingWindowReason(business, new Date("2026-08-26T14:00:00Z"), now)).toBeUndefined();
    const midnight = new Date(timezone === "Africa/Lagos" ? "2026-08-27T23:00:00Z" : "2026-08-28T04:00:00Z");
    expect(bookingWindowReason(business, new Date(+midnight - 1), now)).toBeUndefined();
    expect(bookingWindowReason(business, midnight, now)).toMatch(/horizon/);
  });
});

it("fails closed for nonexistent DST opening times", () => {
  expect(operatingWindow(new Date("2026-03-08T12:00:00Z"), "America/New_York", "02:30", "18:00")).toBeNull();
});
