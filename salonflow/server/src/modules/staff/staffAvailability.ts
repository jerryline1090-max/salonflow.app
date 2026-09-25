import { LocationType } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export interface AvailabilityCheckInput {
  staffId: string;
  businessId: string;
  startsAt: Date;
  endsAt: Date; // requested service window, buffer already included by caller
  locationType: LocationType;
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
export async function checkStaffAvailability(input: AvailabilityCheckInput): Promise<AvailabilityResult> {
  const staff = await prisma.staff.findUnique({ where: { id: input.staffId } });
  if (!staff || staff.businessId !== input.businessId) {
    return { available: false, reason: "Staff member not found" };
  }
  if (staff.status !== "ACTIVE") {
    return { available: false, reason: `Staff member is ${staff.status.toLowerCase()}` };
  }
  if (input.locationType === "HOME" && !staff.homeServiceEligible) {
    return { available: false, reason: "Staff member is not eligible for home service" };
  }

  const dayOfWeek = input.startsAt.getDay();
  const schedule = await prisma.staffSchedule.findUnique({
    where: { staffId_dayOfWeek: { staffId: input.staffId, dayOfWeek } },
  });
  if (!schedule || schedule.isOff) {
    return { available: false, reason: "Staff member does not work on this day" };
  }
  if (!withinWorkingHours(input.startsAt, input.endsAt, schedule.startTime, schedule.endTime)) {
    return { available: false, reason: "Requested time is outside staff working hours" };
  }

  const timeOff = await prisma.staffTimeOff.findFirst({
    where: {
      staffId: input.staffId,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
  });
  if (timeOff) {
    return { available: false, reason: "Staff member has approved time off during this window" };
  }

  // Pull the buffer window: for HOME appointments, extend the "busy" window
  // on both sides by the travel buffer, so a back-to-back booking that
  // doesn't leave travel time is rejected rather than silently double-booked.
  const bufferMins =
    input.locationType === "HOME"
      ? await resolveHomeTravelBufferMinutes(input.businessId)
      : 0;

  const bufferedStart = addMinutes(input.startsAt, -bufferMins);
  const bufferedEnd = addMinutes(input.endsAt, bufferMins);

  const conflict = await prisma.appointment.findFirst({
    where: {
      staffId: input.staffId,
      id: input.excludeAppointmentId ? { not: input.excludeAppointmentId } : undefined,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { lt: bufferedEnd },
      endsAt: { gt: bufferedStart },
    },
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

function withinWorkingHours(startsAt: Date, endsAt: Date, openTime: string, closeTime: string): boolean {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const startMins = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMins = endsAt.getHours() * 60 + endsAt.getMinutes();
  return startMins >= toMinutes(openTime) && endMins <= toMinutes(closeTime);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

async function resolveHomeTravelBufferMinutes(businessId: string): Promise<number> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  return business?.homeServiceTravelBufferMins ?? 0;
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
  if (!service) return [];

  const candidateStaff = params.staffId
    ? [params.staffId]
    : (
        await prisma.staffService.findMany({
          where: { serviceId: params.serviceId, staff: { status: "ACTIVE", businessId: params.businessId } },
          select: { staffId: true },
        })
      ).map((s) => s.staffId);

  const results: { staffId: string; startsAt: Date; endsAt: Date }[] = [];
  const daysToSearch = params.daysToSearch ?? 14;
  const maxResults = params.maxResults ?? 5;
  const slotStepMinutes = 15;

  for (let dayOffset = 0; dayOffset < daysToSearch && results.length < maxResults; dayOffset++) {
    const day = new Date(params.fromDate);
    day.setDate(day.getDate() + dayOffset);

    for (const staffId of candidateStaff) {
      if (results.length >= maxResults) break;
      const schedule = await prisma.staffSchedule.findUnique({
        where: { staffId_dayOfWeek: { staffId, dayOfWeek: day.getDay() } },
      });
      if (!schedule || schedule.isOff) continue;

      const [openH, openM] = schedule.startTime.split(":").map(Number);
      const [closeH, closeM] = schedule.endTime.split(":").map(Number);
      const dayOpen = new Date(day);
      dayOpen.setHours(openH, openM, 0, 0);
      const dayClose = new Date(day);
      dayClose.setHours(closeH, closeM, 0, 0);

      for (
        let candidateStart = new Date(dayOpen);
        candidateStart.getTime() + service.durationMinutes * 60_000 <= dayClose.getTime();
        candidateStart = new Date(candidateStart.getTime() + slotStepMinutes * 60_000)
      ) {
        const candidateEnd = new Date(candidateStart.getTime() + service.durationMinutes * 60_000);
        const check = await checkStaffAvailability({
          staffId,
          businessId: params.businessId,
          startsAt: candidateStart,
          endsAt: candidateEnd,
          locationType: params.locationType,
        });
        if (check.available) {
          results.push({ staffId, startsAt: candidateStart, endsAt: candidateEnd });
          break; // one suggestion per staff member per day keeps results varied
        }
      }
    }
  }

  return results.slice(0, maxResults);
}
