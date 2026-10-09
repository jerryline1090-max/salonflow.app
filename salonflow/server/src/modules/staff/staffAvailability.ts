import { LocationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { bookingWindowReason, businessWeekday, operatingWindow } from "../appointments/bookingWindow";
import { shiftCalendarDay, zonedDateTimeToUtc, zonedParts } from "../../core/timezone";

export interface AvailabilityCheckInput {
  staffId: string;
  businessId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date; // requested service window, buffer already included by caller
  locationType: LocationType;
  // Historical appointments persist their resolved travel buffer. New
  // requests pass the service-specific value selected at booking time.
  travelBufferMins?: number;
  excludeAppointmentId?: string; // when checking availability for a reschedule of the same appointment
}

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
}

/**
 * Section 12: home-service intelligence.
 *
 * This is the one place that decides "can this staff member actually be
 * here at this time" — for both salon and home appointments. It must never
 * be re-implemented ad hoc in a controller; every booking surface (dashboard,
 * calendar, AI Receptionist) calls this before confirming a slot.
 *
 * Checks, in order:
 *  1. Staff is ACTIVE (not removed/inactive)
 *  2. Staff works this day/time per their weekly schedule
 *  3. Staff has no approved time off covering this window
 *  4. Staff has no overlapping appointment — where "overlapping" for a HOME
 *     appointment also swallows the travel buffer on both sides, so we never
 *     book a physically impossible schedule (the Ada example in the spec:
 *     home service 2:00 PM immediately followed by a salon appointment
 *     at 2:30 PM with no time to travel back).
 */
export async function checkStaffAvailability(input: AvailabilityCheckInput, db: Prisma.TransactionClient = prisma, now = new Date()): Promise<AvailabilityResult> {
  if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime()) || input.endsAt <= input.startsAt) {
    return { available: false, reason: "Invalid appointment interval" };
  }
  const service = await db.service.findUnique({ where: { id: input.serviceId } });
  if (!service || service.businessId !== input.businessId || !service.isActive) return { available: false, reason: "Service is not available for this business" };
  if (!Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0 || !Number.isInteger(service.bufferMinutes) || service.bufferMinutes < 0) return { available: false, reason: "Service duration or buffer is invalid" };
  if ((input.locationType === "HOME" && !service.availableAtHome) || (input.locationType === "SALON" && !service.availableAtSalon)) return { available: false, reason: "Service is not offered at this location" };
  const staff = await db.staff.findUnique({ where: { id: input.staffId } });
  if (!staff || staff.businessId !== input.businessId) {
    return { available: false, reason: "Staff member not found" };
  }
  if (staff.status !== "ACTIVE") {
    return { available: false, reason: `Staff member is ${staff.status.toLowerCase()}` };
  }
  if (input.locationType === "HOME" && !staff.homeServiceEligible) {
    return { available: false, reason: "Staff member is not eligible for home service" };
  }

  if (!await db.staffService.findUnique({ where: { staffId_serviceId: { staffId: input.staffId, serviceId: input.serviceId } } })) return { available: false, reason: "Staff member is not qualified to perform this service" };
  const business = await db.business.findUnique({ where: { id: input.businessId } });
  if (!business) return { available: false, reason: "Business not found" };
  if ((input.locationType === "HOME" && business.mode === "SALON_ONLY") || (input.locationType === "SALON" && business.mode === "HOME_ONLY")) return { available: false, reason: "Business does not offer this location type" };
  const limitReason = bookingWindowReason(business, input.startsAt, now);
  if (limitReason) return { available: false, reason: limitReason };
  const requestedTravelBufferMins = input.locationType === "HOME" ? input.travelBufferMins ?? service.homeTravelBufferMins ?? business.homeServiceTravelBufferMins : 0;
  if (!Number.isInteger(requestedTravelBufferMins) || requestedTravelBufferMins < 0) return { available: false, reason: "Invalid travel buffer" };
  const requestedStart = addMinutes(input.startsAt, -requestedTravelBufferMins);
  const requestedEnd = addMinutes(input.endsAt, requestedTravelBufferMins);
  const dayOfWeek = businessWeekday(input.startsAt, business.timezone);
  const hours = await db.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId: input.businessId, dayOfWeek } } });
  const businessWindow = hours && !hours.isClosed ? operatingWindow(input.startsAt, business.timezone, hours.openTime, hours.closeTime) : null;
  if (!businessWindow || requestedStart < businessWindow.startsAt || requestedEnd > businessWindow.endsAt) return { available: false, reason: "Requested time is outside business hours" };
  const schedule = await db.staffSchedule.findUnique({
    where: { staffId_dayOfWeek: { staffId: input.staffId, dayOfWeek } },
  });
  if (!schedule || schedule.isOff) {
    return { available: false, reason: "Staff member does not work on this day" };
  }
  const staffWindow = operatingWindow(input.startsAt, business.timezone, schedule.startTime, schedule.endTime);
  if (!staffWindow || requestedStart < staffWindow.startsAt || requestedEnd > staffWindow.endsAt) {
    return { available: false, reason: "Requested time is outside staff working hours" };
  }

  const timeOff = await db.staffTimeOff.findFirst({
    where: {
      staffId: input.staffId,
      startsAt: { lt: requestedEnd },
      endsAt: { gt: requestedStart },
    },
  });
  if (timeOff) {
    return { available: false, reason: "Staff member has approved time off during this window" };
  }

  // Travel must be available when either side of a handoff is a home visit.
  // Existing appointments use their historical `travelBufferMins`; a new
  // request uses its resolved service-specific value. This avoids rewriting
  // old travel assumptions when a business changes its default later.
  // Historical HOME travel buffers may exceed today's configured default.
  // A scoped aggregate supplies a safe query bound without omitting those rows.
  const buffers = await db.appointment.aggregate({ where: {
    businessId: input.businessId, staffId: input.staffId,
    status: { in: ["PENDING", "CONFIRMED"] }, locationType: "HOME",
  }, _max: { travelBufferMins: true } });
  const maxTravel = Math.max(0, buffers._max.travelBufferMins ?? 0);
  const existingAppointments = await db.appointment.findMany({
    where: {
      businessId: input.businessId,
      staffId: input.staffId,
      id: input.excludeAppointmentId ? { not: input.excludeAppointmentId } : undefined,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { lt: addMinutes(requestedEnd, maxTravel) },
      endsAt: { gt: addMinutes(requestedStart, -maxTravel) },
    },
    select: { id: true, startsAt: true, endsAt: true, locationType: true, travelBufferMins: true },
  });

  const conflict = existingAppointments.find((appointment) => {
    const existingTravelBufferMins = appointment.locationType === "HOME" ? appointment.travelBufferMins : 0;
    const existingStart = addMinutes(appointment.startsAt, -existingTravelBufferMins);
    const existingEnd = addMinutes(appointment.endsAt, existingTravelBufferMins);
    return existingStart < requestedEnd && existingEnd > requestedStart;
  });

  if (conflict) {
    const reason =
      conflict.locationType === "HOME" || input.locationType === "HOME"
        ? "Conflicts with another appointment once travel time is accounted for"
        : "Staff member already has an appointment at this time";
    return { available: false, reason };
  }

  return { available: true };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Finds real open slots for a staff member (or any qualified staff member)
 * over the next N days — used by both the dashboard "new appointment" screen
 * and the AI Receptionist so a "fully booked" moment always offers genuine
 * alternatives instead of a dead end (section 22). Never invents slots.
 */
export async function findNextAvailableSlots(params: {
  businessId: string;
  serviceId: string;
  locationType: LocationType;
  staffId?: string; // if omitted, considers any staff member qualified for the service
  fromDate: Date;
  daysToSearch?: number;
  maxResults?: number;
}): Promise<{ staffId: string; startsAt: Date; endsAt: Date }[]> {
  const service = await prisma.service.findUnique({ where: { id: params.serviceId } });
  if (!service || service.businessId !== params.businessId || !service.isActive) return [];
  const business = await prisma.business.findUnique({ where: { id: params.businessId } });
  if (!business || !Number.isFinite(params.fromDate.getTime())) return [];
  const now = new Date();

  const candidateStaff = params.staffId
    ? [params.staffId]
    : (
        await prisma.staffService.findMany({
          where: { serviceId: params.serviceId, staff: { status: "ACTIVE", businessId: params.businessId } },
          select: { staffId: true },
        })
      ).map((s) => s.staffId);

  const results: { staffId: string; startsAt: Date; endsAt: Date }[] = [];
  const daysToSearch = Math.min(31, Math.max(0, Math.trunc(params.daysToSearch ?? 14)));
  const maxResults = Math.min(20, Math.max(0, Math.trunc(params.maxResults ?? 5)));
  const slotStepMinutes = 15;

  for (let dayOffset = 0; dayOffset < daysToSearch && results.length < maxResults; dayOffset++) {
    const day = zonedDateTimeToUtc(shiftCalendarDay(zonedParts(params.fromDate, business.timezone), dayOffset), business.timezone);

    for (const staffId of candidateStaff) {
      if (results.length >= maxResults) break;
      const schedule = await prisma.staffSchedule.findUnique({
        where: { staffId_dayOfWeek: { staffId, dayOfWeek: businessWeekday(day, business.timezone) } },
      });
      if (!schedule || schedule.isOff) continue;

      const window = operatingWindow(day, business.timezone, schedule.startTime, schedule.endTime);
      if (!window) continue;
      const dayOpen = window.startsAt;
      const dayClose = window.endsAt;
      const duration = service.durationMinutes + service.bufferMinutes;
      if (!Number.isFinite(duration) || duration <= 0) continue;

      for (
        let candidateStart = new Date(dayOpen);
        candidateStart.getTime() + duration * 60_000 <= dayClose.getTime();
        candidateStart = new Date(candidateStart.getTime() + slotStepMinutes * 60_000)
      ) {
        if (candidateStart < params.fromDate) continue;
        const candidateEnd = new Date(candidateStart.getTime() + duration * 60_000);
        const check = await checkStaffAvailability({
          staffId,
          businessId: params.businessId,
          serviceId: params.serviceId,
          startsAt: candidateStart,
          endsAt: candidateEnd,
          locationType: params.locationType,
        }, prisma, now);
        if (check.available) {
          results.push({ staffId, startsAt: candidateStart, endsAt: candidateEnd });
          break; // one suggestion per staff member per day keeps results varied
        }
      }
    }
  }

  return results.slice(0, maxResults);
}
