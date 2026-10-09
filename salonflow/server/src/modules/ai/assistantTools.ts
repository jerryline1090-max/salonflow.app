import { LocationType, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ActorContext, assertCan } from "../../core/permissions";
import { resolveOwnStaffId } from "../staff/resolveOwnStaffId";
import { checkStaffAvailability } from "../staff/staffAvailability";
import { businessWeekday } from "../appointments/bookingWindow";
import {
  rescheduleAppointment,
  changeAppointmentStatus as changeAppointmentStatusService,
  reassignAppointmentStaff,
} from "../appointments/appointmentService";
import { getClientStats as getClientStatsService } from "../clients/clientStats";
import {
  getRevenueReport as getRevenueReportService,
  getAppointmentOutcomeReport as getAppointmentOutcomeReportService,
  getPopularServicesReport as getPopularServicesReportService,
  getStaffPerformanceReport as getStaffPerformanceReportService,
  getClientRetentionReport as getClientRetentionReportService,
} from "../reports/reportService";
import { getOutstandingBalance as getOutstandingBalanceService } from "../payments/paymentService";
import { resolveProviderSlug } from "../integrations/providerSlug";

/**
 * Section 27 (hard rule), literally in code: every function below calls
 * the exact same `assertCan()` the REST routes use, for the exact same
 * actor. There is no separate, more permissive path for AI-originated
 * requests — "User -> Role -> Permissions -> UI + AI", never
 * "User -> AI -> Everything". If a STAFF user can't view Reports through
 * the dashboard, `getRevenueReport` throws PermissionDeniedError here
 * exactly the same way `requirePermission()` would 403 the equivalent
 * route — the assistant orchestrator surfaces that to the model as a tool
 * error, so it tells the user plainly rather than having ever fetched the
 * data.
 */

async function assertOwnAppointmentIfStaff(actor: ActorContext, appointment: { staffId: string }) {
  if (actor.role !== "STAFF") return;
  const ownStaffId = await resolveOwnStaffId(actor.userId);
  if (appointment.staffId !== ownStaffId) {
    throw new Error("This appointment belongs to a different staff member");
  }
}

export interface SearchAppointmentsInput {
  clientName?: string;
  staffName?: string;
  dateFrom?: Date;
  dateTo?: Date;
  status?: AppointmentStatus;
}

export async function searchAppointments(actor: ActorContext, input: SearchAppointmentsInput) {
  await assertCan(actor, "appointments", "view");

  const where: any = { businessId: actor.businessId };
  if (input.status) where.status = input.status;
  if (input.dateFrom || input.dateTo) {
    where.startsAt = {};
    if (input.dateFrom) where.startsAt.gte = input.dateFrom;
    if (input.dateTo) where.startsAt.lte = input.dateTo;
  }
  if (input.clientName) where.client = { name: { contains: input.clientName, mode: "insensitive" } };
  if (input.staffName) where.staff = { name: { contains: input.staffName, mode: "insensitive" } };

  // Same scoping rule as the REST layer: a STAFF user's assistant session
  // only ever searches their own appointments.
  if (actor.role === "STAFF") {
    const ownStaffId = await resolveOwnStaffId(actor.userId);
    where.staffId = ownStaffId ?? "__none__";
  }

  return prisma.appointment.findMany({
    where,
    include: { client: true, service: true, staff: true },
    orderBy: { startsAt: "asc" },
    take: 20,
  });
}

export async function getAppointment(actor: ActorContext, appointmentId: string) {
  await assertCan(actor, "appointments", "view");
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.businessId !== actor.businessId) throw new Error("Appointment not found");
  await assertOwnAppointmentIfStaff(actor, appointment);
  return appointment;
}

export async function moveAppointment(actor: ActorContext, appointmentId: string, newStartsAt: Date) {
  await assertCan(actor, "appointments", "edit");
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.businessId !== actor.businessId) throw new Error("Appointment not found");
  await assertOwnAppointmentIfStaff(actor, appointment);

  return rescheduleAppointment({ appointmentId, newStartsAt, actor: { type: "AI", userId: actor.userId } });
}

export async function changeAppointmentStatusTool(
  actor: ActorContext,
  appointmentId: string,
  newStatus: AppointmentStatus,
  reason?: string
) {
  await assertCan(actor, "appointments", "edit");
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.businessId !== actor.businessId) throw new Error("Appointment not found");
  await assertOwnAppointmentIfStaff(actor, appointment);

  return changeAppointmentStatusService({ appointmentId, newStatus, reason, actor: { type: "AI", userId: actor.userId } });
}

export async function reassignAppointmentTool(actor: ActorContext, appointmentId: string, newStaffId: string, reason?: string) {
  await assertCan(actor, "appointments", "edit");
  // Section 11: reassignment is an owner/manager decision — the same
  // restriction routes/appointments.routes.ts applies, regardless of the
  // generic "edit" permission a STAFF role happens to have by default.
  if (actor.role === "STAFF") {
    throw new Error("Only an owner or manager can reassign an appointment to different staff");
  }
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.businessId !== actor.businessId) throw new Error("Appointment not found");

  return reassignAppointmentStaff({ appointmentId, newStaffId, reason, actor: { type: "AI", userId: actor.userId } });
}

export async function getRevenueReport(actor: ActorContext, from: Date, to: Date) {
  await assertCan(actor, "reports", "view");
  return getRevenueReportService(actor.businessId!, from, to);
}

export async function getAppointmentOutcomeReport(actor: ActorContext, from: Date, to: Date) {
  await assertCan(actor, "reports", "view");
  return getAppointmentOutcomeReportService(actor.businessId!, from, to);
}

export async function getPopularServicesReport(actor: ActorContext, from: Date, to: Date) {
  await assertCan(actor, "reports", "view");
  return getPopularServicesReportService(actor.businessId!, from, to);
}

export async function getStaffPerformanceReport(actor: ActorContext, from: Date, to: Date) {
  await assertCan(actor, "reports", "view");
  return getStaffPerformanceReportService(actor.businessId!, from, to);
}

export async function getClientRetentionReport(actor: ActorContext) {
  await assertCan(actor, "reports", "view");
  return getClientRetentionReportService(actor.businessId!);
}

export async function getClientCount(actor: ActorContext) {
  await assertCan(actor, "clients", "view");
  return prisma.client.count({ where: { businessId: actor.businessId } });
}

export async function getClientStats(actor: ActorContext, clientId: string) {
  await assertCan(actor, "clients", "view");
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.businessId !== actor.businessId) throw new Error("Client not found");
  return getClientStatsService(clientId);
}

export async function listStaffAvailableOnDate(actor: ActorContext, date: Date) {
  await assertCan(actor, "staff", "view");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: actor.businessId! } });
  const dayOfWeek = businessWeekday(date, business.timezone);

  const staff = await prisma.staff.findMany({
    where: { businessId: actor.businessId, status: "ACTIVE" },
    include: { schedule: { where: { dayOfWeek } }, timeOff: true },
  });

  return staff
    .filter((s) => {
      const daySchedule = s.schedule[0];
      if (!daySchedule || daySchedule.isOff) return false;
      const onLeave = s.timeOff.some((t) => t.startsAt <= date && t.endsAt >= date);
      return !onLeave;
    })
    .map((s) => ({ staffId: s.id, name: s.name, workingHours: `${s.schedule[0].startTime}-${s.schedule[0].endTime}` }));
}

export interface ExplainStaffAvailabilityInput {
  staffId: string;
  serviceId: string;
  startsAt: Date;
  locationType: LocationType;
}

export async function explainStaffAvailability(actor: ActorContext, input: ExplainStaffAvailabilityInput) {
  await assertCan(actor, "staff", "view");
  await assertCan(actor, "appointments", "view");

  const service = await prisma.service.findUniqueOrThrow({ where: { id: input.serviceId } });
  if (service.businessId !== actor.businessId) throw new Error("Service not found");
  const endsAt = new Date(input.startsAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000);

  return checkStaffAvailability({
    serviceId: input.serviceId,
    staffId: input.staffId,
    businessId: actor.businessId!,
    startsAt: input.startsAt,
    endsAt,
    locationType: input.locationType,
  });
}

export async function getIntegrationStatus(actor: ActorContext, providerSlug: string) {
  await assertCan(actor, "integrations", "view");
  const provider = resolveProviderSlug(providerSlug);
  const integration = await prisma.integration.findFirst({ where: { businessId: actor.businessId, provider } });
  return integration ?? { provider, status: "NOT_CONNECTED" };
}

export async function getOutstandingBalance(actor: ActorContext, appointmentId: string) {
  await assertCan(actor, "payments", "view");
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.businessId !== actor.businessId) throw new Error("Appointment not found");
  return getOutstandingBalanceService(appointmentId);
}
