import { shiftCalendarDay, zonedDateTimeToUtc, zonedParts } from "../../core/timezone";

export function businessWeekday(instant: Date, timezone: string) {
  const p = zonedParts(instant, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** A same-day operating window; overnight schedules are not supported. */
export function operatingWindow(day: Date, timezone: string, open: string, close: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close) || close <= open) return null;
  const p = zonedParts(day, timezone);
  const at = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    const instant = zonedDateTimeToUtc({ ...p, hour, minute, second: 0 }, timezone);
    const actual = zonedParts(instant, timezone);
    // Fail closed for a nonexistent DST wall-clock boundary.
    return actual.hour === hour && actual.minute === minute ? instant : null;
  };
  const startsAt = at(open);
  const endsAt = at(close);
  return startsAt && endsAt && endsAt > startsAt ? { startsAt, endsAt } : null;
}

export function bookingWindowReason(
  business: { timezone: string; minBookingNoticeMins: number; maxBookingHorizonDays: number },
  startsAt: Date,
  now: Date,
): string | undefined {
  if (!Number.isInteger(business.minBookingNoticeMins) || business.minBookingNoticeMins < 0 ||
      !Number.isInteger(business.maxBookingHorizonDays) || business.maxBookingHorizonDays < 0) return "Booking limits are not configured correctly";
  // Elapsed minutes, not wall-clock arithmetic; equality is allowed.
  if (startsAt.getTime() < now.getTime() + business.minBookingNoticeMins * 60_000) return "Minimum booking notice has not been met";
  // Entire business-local day today + N is included; next midnight is excluded.
  const nextDay = shiftCalendarDay(zonedParts(now, business.timezone), business.maxBookingHorizonDays + 1);
  if (startsAt >= zonedDateTimeToUtc(nextDay, business.timezone)) return "Maximum booking horizon exceeded";
  return undefined;
}
