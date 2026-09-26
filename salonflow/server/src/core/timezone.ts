export class InvalidTimezoneError extends Error {
  constructor() {
    super("Timezone must be a valid IANA timezone identifier");
    this.name = "InvalidTimezoneError";
  }
}

/** Validates IANA identifiers using the ICU timezone database bundled with Node. */
export function assertValidTimezone(timezone: unknown): asserts timezone is string {
  if (typeof timezone !== "string" || !timezone.trim()) throw new InvalidTimezoneError();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new InvalidTimezoneError();
  }
}

type ZonedDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/**
 * Produces a UTC instant for a wall-clock time in an IANA timezone. The
 * offset is resolved at the target date, not treated as a fixed offset, so
 * daylight-saving changes are handled by Node's ICU timezone database.
 */
export function zonedDateTimeToUtc(parts: ZonedDateParts, timezone: string, milliseconds = 0): Date {
  assertValidTimezone(timezone);
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, milliseconds);
  let instant = new Date(utcGuess - timezoneOffsetAt(new Date(utcGuess), timezone));
  const correctedOffset = timezoneOffsetAt(instant, timezone);
  instant = new Date(utcGuess - correctedOffset);
  return instant;
}

/** Returns inclusive local-day boundaries as UTC instants for a salon timezone. */
export function businessDayRange(timezone: string, daysBack: number, now = new Date()) {
  assertValidTimezone(timezone);
  const today = zonedParts(now, timezone);
  const fromDay = shiftCalendarDay(today, -daysBack);
  return {
    from: zonedDateTimeToUtc({ ...fromDay, hour: 0, minute: 0, second: 0 }, timezone),
    to: zonedDateTimeToUtc({ ...today, hour: 23, minute: 59, second: 59 }, timezone, 999),
  };
}

/** Current business month through the end of the salon's current local day. */
export function businessMonthToDateRange(timezone: string, now = new Date()) {
  assertValidTimezone(timezone);
  const today = zonedParts(now, timezone);
  return {
    from: zonedDateTimeToUtc({ year: today.year, month: today.month, day: 1, hour: 0, minute: 0, second: 0 }, timezone),
    to: zonedDateTimeToUtc({ ...today, hour: 23, minute: 59, second: 59 }, timezone, 999),
  };
}

function timezoneOffsetAt(instant: Date, timezone: string) {
  const parts = zonedParts(instant, timezone);
  // Intl's formatted parts are second-precision. Ignore the source instant's
  // milliseconds while deriving an offset so they are applied exactly once by
  // zonedDateTimeToUtc.
  const instantAtSecond = Math.floor(instant.getTime() / 1_000) * 1_000;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instantAtSecond;
}

function zonedParts(instant: Date, timezone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function shiftCalendarDay(parts: ZonedDateParts, days: number): ZonedDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: 0, minute: 0, second: 0 };
}
