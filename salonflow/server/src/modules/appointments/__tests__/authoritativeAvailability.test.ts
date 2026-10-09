jest.mock("../../../lib/prisma");
jest.mock("../../../core/eventBus", () => ({ eventBus: { emit: jest.fn() } }));
import { prisma } from "../../../lib/prisma";
import { checkStaffAvailability, findNextAvailableSlots } from "../../staff/staffAvailability";
import { createAppointment, rescheduleAppointment, reassignAppointmentStaff, changeAppointmentStatus } from "../appointmentService";
import { eventBus } from "../../../core/eventBus";
import { Prisma } from "@prisma/client";
import { buildAppointment, buildBusiness, buildClient, buildService, buildStaff, buildSchedule } from "../../../test-utils/factories";

const now = new Date("2026-08-26T06:00:00Z");
const start = new Date("2026-08-26T08:00:00Z"); // Lagos 09:00
const input = { businessId: "biz_1", serviceId: "svc_1", staffId: "staff_1", startsAt: start, endsAt: new Date(+start + 75 * 60_000), locationType: "SALON" as const };
const actor = { type: "USER" as const, userId: "user_1" };
beforeEach(() => {
  (prisma.appointment.aggregate as jest.Mock).mockResolvedValue({ _max: { travelBufferMins: 45 } });
  jest.useFakeTimers().setSystemTime(now);
  (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness({ timezone: "Africa/Lagos", minBookingNoticeMins: 120, maxBookingHorizonDays: 1 }));
  (prisma.businessHours.findUnique as jest.Mock).mockResolvedValue({ openTime: "09:00", closeTime: "18:00", isClosed: false });
  (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
  (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule());
  (prisma.staffService.findUnique as jest.Mock).mockResolvedValue({ id: "link" });
  (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService({ durationMinutes: 60, bufferMinutes: 15 }));
  (prisma.client.findUnique as jest.Mock).mockResolvedValue(buildClient());
  (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma));
  (prisma.appointment.create as jest.Mock).mockImplementation(async ({ data }) => ({ id: "new", ...data }));
});
afterEach(() => jest.useRealTimers());

it.each([
  ["closed day", "businessHours", { openTime: "09:00", closeTime: "18:00", isClosed: true }],
  ["staff off", "staffSchedule", buildSchedule({ isOff: true })],
  ["inactive staff", "staff", buildStaff({ status: "INACTIVE" })],
  ["inactive service", "service", buildService({ isActive: false })],
  ["foreign service", "service", buildService({ businessId: "other" })],
  ["foreign staff", "staff", buildStaff({ businessId: "other" })],
  ["incompatible staff", "staffService", null],
] as const)("search and creation reject %s", async (_label, model, row) => {
  (prisma[model].findUnique as jest.Mock).mockResolvedValue(row);
  expect((await checkStaffAvailability(input)).available).toBe(false);
  expect(await findNextAvailableSlots({ ...input, fromDate: start, daysToSearch: 1 })).toEqual([]);
  await expect(createAppointment({ ...input, clientId: "client_1", bookingChannel: "DASHBOARD", actor })).rejects.toThrow();
  expect(prisma.appointment.create).not.toHaveBeenCalled();
});
it("search returns the same buffered interval accepted by create", async () => {
  const slots = await findNextAvailableSlots({ ...input, fromDate: start, daysToSearch: 1 });
  expect(slots).toEqual([{ staffId: "staff_1", startsAt: start, endsAt: input.endsAt }]);
  const created = await createAppointment({ ...input, clientId: "client_1", bookingChannel: "DASHBOARD", actor });
  expect(created.endsAt).toEqual(slots[0].endsAt);
  expect(prisma.businessHours.findUnique).toHaveBeenCalledWith({ where: { businessId_dayOfWeek: { businessId: "biz_1", dayOfWeek: 3 } } });
  expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  expect(eventBus.emit).toHaveBeenCalledTimes(1);
});
it("allows exact closing boundary, rejects spanning closing and another day", async () => {
  expect((await checkStaffAvailability({ ...input, endsAt: new Date("2026-08-26T17:00:00Z") })).available).toBe(true);
  expect((await checkStaffAvailability({ ...input, endsAt: new Date("2026-08-26T17:00:00.001Z") })).available).toBe(false);
  expect((await checkStaffAvailability({ ...input, endsAt: new Date("2026-08-27T08:00:00Z") })).available).toBe(false);
});
it("rejects before opening independently of notice", async () => {
  jest.setSystemTime(new Date("2026-08-25T06:00:00Z"));
  expect((await checkStaffAvailability({ ...input, startsAt: new Date(+start - 1) })).reason).toMatch(/business hours/);
});
it("rejects time off and uses occupied travel interval", async () => {
  (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue({ id: "off" });
  expect((await checkStaffAvailability(input)).reason).toMatch(/time off/);
  const homeStart = new Date("2026-08-26T10:00:00Z");
  await checkStaffAvailability({ ...input, startsAt: homeStart, endsAt: new Date(+homeStart + 60_000), locationType: "HOME" });
  expect(prisma.staffTimeOff.findFirst).toHaveBeenLastCalledWith({ where: { staffId: "staff_1", startsAt: { lt: new Date(+homeStart + 46 * 60_000) }, endsAt: { gt: new Date(+homeStart - 45 * 60_000) } } });
});
it("allows a half-open buffer boundary and rejects one millisecond overlap", async () => {
  (prisma.appointment.findMany as jest.Mock).mockResolvedValue([{ id: "existing", startsAt: input.endsAt, endsAt: new Date(+input.endsAt + 60_000), locationType: "SALON", travelBufferMins: 0 }]);
  expect((await checkStaffAvailability(input)).available).toBe(true);
  expect((await checkStaffAvailability({ ...input, endsAt: new Date(+input.endsAt + 1) })).available).toBe(false);
});
it.each(["COMPLETED", "CANCELLED", "NO_SHOW"])("cannot reschedule or reassign terminal %s", async (status) => {
  (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ status }));
  await expect(rescheduleAppointment({ appointmentId: "appt_1", newStartsAt: start, actor })).rejects.toThrow(/terminal/);
  await expect(reassignAppointmentStaff({ appointmentId: "appt_1", newStaffId: "staff_1", actor })).rejects.toThrow(/terminal/);
  expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
});
it("fences a status changed between intent read and transactional read", async () => {
  (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce(buildAppointment()).mockResolvedValueOnce(buildAppointment({ status: "CANCELLED" }));
  await expect(changeAppointmentStatus({ appointmentId: "appt_1", newStatus: "COMPLETED", actor })).rejects.toMatchObject({ statusCode: 409 });
  expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
  expect(prisma.appointmentEvent.create).not.toHaveBeenCalled();
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
});
it("zero-row conditional update produces no history, audit or event", async () => {
  (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment());
  (prisma.appointment.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  await expect(changeAppointmentStatus({ appointmentId: "appt_1", newStatus: "COMPLETED", actor })).rejects.toMatchObject({ statusCode: 409 });
  expect(prisma.appointmentEvent.create).not.toHaveBeenCalled();
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
  expect(eventBus.emit).not.toHaveBeenCalled();
});

it("audit failure rejects the transaction before notification dispatch", async () => {
  (prisma.auditLog.create as jest.Mock).mockRejectedValue(new Error("audit failed"));
  await expect(createAppointment({ ...input, clientId: "client_1", bookingChannel: "DASHBOARD", actor })).rejects.toThrow("audit failed");
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(eventBus.emit).not.toHaveBeenCalled();
});

it("a serialization retry reruns validation but dispatches only after successful commit", async () => {
  let attempts = 0;
  (prisma.$transaction as jest.Mock).mockImplementation(async fn => {
    const result = await fn(prisma);
    if (++attempts === 1) throw new Prisma.PrismaClientKnownRequestError("serialization", { code: "P2034", clientVersion: "test" });
    return result;
  });
  await createAppointment({ ...input, clientId: "client_1", bookingChannel: "DASHBOARD", actor });
  expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  expect(prisma.businessHours.findUnique).toHaveBeenCalledTimes(2);
  expect(eventBus.emit).toHaveBeenCalledTimes(1);
  // This proves dispatch placement, not PostgreSQL rollback: real-DB evidence
  // is separately required to prove committed Appointment/Event/Audit counts.
});

it("a retry cannot overwrite the winner's rescheduled time", async () => {
  const original = buildAppointment({ startsAt: start, endsAt: input.endsAt });
  (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, startsAt: new Date(+start + 60_000) });
  await expect(rescheduleAppointment({ appointmentId: "appt_1", newStartsAt: start, actor })).rejects.toMatchObject({ statusCode: 409 });
  expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
});

it("notice equality applies to every booking channel and cannot be bypassed by browser channel", async () => {
  expect((await checkStaffAvailability(input)).available).toBe(true);
  const tooSoon = { ...input, startsAt: new Date(+start - 1) };
  expect((await checkStaffAvailability(tooSoon)).reason).toMatch(/notice/);
  for (const bookingChannel of ["DASHBOARD", "AI_RECEPTIONIST"] as const) {
    await expect(createAppointment({ ...tooSoon, clientId: "client_1", bookingChannel, actor })).rejects.toThrow(/notice/);
  }
});
