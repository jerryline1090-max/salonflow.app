/**
 * Factory helpers so each test only has to specify the fields it cares
 * about. Defaults are deliberately "happy path" (active staff, active
 * service, business hours 09:00-18:00) so a test that overrides one field
 * is clearly testing that one thing.
 */

export function buildBusiness(overrides: Partial<any> = {}) {
  return {
    id: "biz_1",
    name: "Big Kitchen Hair Studio",
    mode: "BOTH",
    homeServiceTravelBufferMins: 30,
    ...overrides,
  };
}

export function buildService(overrides: Partial<any> = {}) {
  return {
    id: "svc_1",
    businessId: "biz_1",
    name: "Knotless Braids",
    price: 4_000_000,
    durationMinutes: 180,
    bufferMinutes: 15,
    isActive: true,
    availableAtSalon: true,
    availableAtHome: true,
    homeTravelBufferMins: 45,
    requiredSkills: ["braiding"],
    ...overrides,
  };
}

export function buildStaff(overrides: Partial<any> = {}) {
  return {
    id: "staff_1",
    businessId: "biz_1",
    name: "Ada",
    status: "ACTIVE",
    homeServiceEligible: true,
    skills: ["braiding"],
    ...overrides,
  };
}

export function buildSchedule(overrides: Partial<any> = {}) {
  return {
    id: "sched_1",
    staffId: "staff_1",
    dayOfWeek: 3, // Wednesday
    startTime: "09:00",
    endTime: "18:00",
    isOff: false,
    ...overrides,
  };
}

export function buildClient(overrides: Partial<any> = {}) {
  return {
    id: "client_1",
    businessId: "biz_1",
    name: "Sarah Client",
    ...overrides,
  };
}

// A Wednesday (dayOfWeek 3) at a fixed time — used across tests so
// "day of week" logic is exercised consistently.
export function wednesdayAt(hour: number, minute = 0) {
  const d = new Date("2026-08-26T00:00:00"); // 2026-08-26 is a Wednesday
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function buildAppointment(overrides: Partial<any> = {}) {
  const startsAt = wednesdayAt(14, 0);
  const endsAt = wednesdayAt(17, 15);
  return {
    id: "appt_1",
    businessId: "biz_1",
    clientId: "client_1",
    serviceId: "svc_1",
    staffId: "staff_1",
    status: "PENDING",
    locationType: "SALON",
    startsAt,
    endsAt,
    travelBufferMins: 0,
    priceSnapshot: 4_000_000,
    durationSnapshot: 180,
    needsAttention: false,
    attentionReason: null,
    ...overrides,
  };
}
