import { prisma } from "../../lib/prisma";
import { businessDayRange, businessMonthToDateRange } from "../../core/timezone";

export class InvalidReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReportRangeError";
  }
}

/** Resolves report dates once, using the persisted Business.timezone as authority. */
export async function resolveReportRange(businessId: string, query: Record<string, unknown>) {
  const timezone = await resolveBusinessTimezone(businessId);

  const fromInput = singleQueryValue(query.from, "from");
  const toInput = singleQueryValue(query.to, "to");
  const daysInput = singleQueryValue(query.days, "days");
  const periodInput = singleQueryValue(query.period, "period");
  const suppliedRangeKinds = [daysInput, periodInput, fromInput === undefined && toInput === undefined ? undefined : "explicit"].filter(Boolean).length;
  if (suppliedRangeKinds > 1) {
    throw new InvalidReportRangeError("Use one report range method at a time");
  }

  if (periodInput === "today") return businessDayRange(timezone, 0);
  if (periodInput === "current-month") return businessMonthToDateRange(timezone);
  if (periodInput !== undefined) throw new InvalidReportRangeError("period must be today or current-month");

  if (daysInput !== undefined) {
    const days = Number(daysInput);
    if (!Number.isSafeInteger(days) || days < 1) throw new InvalidReportRangeError("days must be a positive whole number");
    return businessDayRange(timezone, days);
  }

  const defaultRange = businessDayRange(timezone, 30);
  const from = fromInput === undefined ? defaultRange.from : parseDate(fromInput, "from");
  const to = toInput === undefined ? defaultRange.to : parseDate(toInput, "to");
  if (from > to) throw new InvalidReportRangeError("from must not be later than to");
  return { from, to };
}

async function resolveBusinessTimezone(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  if (!business) throw new Error("Business not found");
  return business.timezone;
}

function singleQueryValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InvalidReportRangeError(`${name} must be a single date value`);
  return value;
}

function parseDate(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new InvalidReportRangeError(`${name} must be a valid date`);
  return date;
}
