import { AppointmentStatus, BookingChannel, LocationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";
import { writeAuditLog } from "../../core/auditLog";
import { checkStaffAvailability } from "../staff/staffAvailability";
import { isTransitionAllowed, InvalidStatusTransitionError } from "./appointmentStateMachine";
import { appointmentTransaction, AppointmentConflictError } from "./appointmentTransaction";

async function appointmentAudit(tx: Prisma.TransactionClient, input: Parameters<typeof writeAuditLog>[0]) {
  await tx.auditLog.create({ data: {
    ...input, actorType: input.actorType ?? "USER",
    previousValue: input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
    newValue: input.newValue === undefined ? null : JSON.stringify(input.newValue),
  } });
}

function assertMovable(status: AppointmentStatus) {
  if (status !== "PENDING" && status !== "CONFIRMED") throw new AppointmentConflictError("A terminal appointment cannot be moved or reassigned.");
}

function assertUnchanged(current: { status: AppointmentStatus; staffId: string; startsAt: Date; endsAt: Date; updatedAt: Date }, expected: typeof current) {
  if (current.status !== expected.status || current.staffId !== expected.staffId ||
      +current.startsAt !== +expected.startsAt || +current.endsAt !== +expected.endsAt ||
      current.updatedAt?.getTime() !== expected.updatedAt?.getTime()) {
    throw new AppointmentConflictError("Appointment changed. Please refresh and try again.");
  }
}

/**
 * THE central booking engine described in section 2 / section 18.
 *
 * Every surface — dashboard, calendar UI, staff app, website widget,
 * WhatsApp via the AI Receptionist, Instagram via the AI Receptionist —
 * calls these same functions. None of them is allowed to write directly
 * to the `appointment` table. This is what makes "a WhatsApp appointment"
 * and "a dashboard appointment" the same underlying object.
 */

export interface CreateAppointmentInput {
  businessId: string;
  clientId: string;
  serviceId: string;
  staffId: string;
  startsAt: Date;
  locationType: LocationType;
  homeAddress?: string;
  bookingChannel: BookingChannel;
  notes?: string;
  actor: { type: "USER" | "AI" | "CLIENT" | "SYSTEM"; userId?: string; staffId?: string };
}

export async function createAppointment(input: CreateAppointmentInput) {
  assertValidDate(input.startsAt, "Appointment start time");
  assertLocationType(input.locationType);
  assertBookingChannel(input.bookingChannel);
  if (!input.clientId || !input.serviceId || !input.staffId) {
    throw new Error("Client, service, and staff are required");
  }
  if (input.locationType === "HOME" && !input.homeAddress?.trim()) {
    throw new Error("A home address is required for home appointments");
  }

  const appointment = await appointmentTransaction(async (tx) => {
  const client = await tx.client.findUnique({ where: { id: input.clientId } });
  if (!client || client.businessId !== input.businessId) {
    throw new Error("Client not found for this business");
  }
  const service = await tx.service.findUnique({ where: { id: input.serviceId } });
  if (!service || service.businessId !== input.businessId) {
    throw new Error("Service not found for this business");
  }
  if (!service.isActive) {
    throw new Error("This service is no longer offered");
  }
  if (input.locationType === "HOME" && !service.availableAtHome) {
    throw new Error("This service is not offered as a home service");
  }
  if (input.locationType === "SALON" && !service.availableAtSalon) {
    throw new Error("This service is not offered at the salon");
  }

  const staff = await tx.staff.findUnique({ where: { id: input.staffId } });
  if (!staff || staff.businessId !== input.businessId) {
    throw new Error("Staff member not found for this business");
  }
  if (staff.status !== "ACTIVE") {
    throw new Error("Staff member is not active");
  }
  if (input.locationType === "HOME" && !staff.homeServiceEligible) {
    throw new Error("Staff member is not eligible for home service");
  }
  const staffService = await tx.staffService.findUnique({
    where: { staffId_serviceId: { staffId: staff.id, serviceId: service.id } },
  });
  if (!staffService) {
    throw new Error("Staff member is not qualified to perform this service");
  }

  const business = await tx.business.findUnique({ where: { id: input.businessId } });
  if (!business) {
    throw new Error("Business not found");
  }
  const travelBufferMins =
    input.locationType === "HOME"
      ? service.homeTravelBufferMins ?? business?.homeServiceTravelBufferMins ?? 0
      : 0;

  const durationWithBuffer = service.durationMinutes + service.bufferMinutes;
  const endsAt = new Date(input.startsAt.getTime() + durationWithBuffer * 60_000);

  const availability = await checkStaffAvailability({
    serviceId: input.serviceId,
    staffId: input.staffId,
    businessId: input.businessId,
    startsAt: input.startsAt,
    endsAt,
    locationType: input.locationType,
    travelBufferMins,
  }, tx);
  if (!availability.available) {
    throw new AppointmentConflictError(`Cannot book this slot: ${availability.reason}`);
  }

    const created = await tx.appointment.create({
      data: {
        businessId: input.businessId,
        clientId: input.clientId,
        serviceId: input.serviceId,
        staffId: input.staffId,
        status: "PENDING",
        locationType: input.locationType,
        homeAddress: input.homeAddress?.trim(),
        startsAt: input.startsAt,
        endsAt,
        travelBufferMins,
        bookingChannel: input.bookingChannel,
        // Snapshot price/duration NOW so a later Service price change never
        // rewrites this appointment's historical numbers (section 13).
        priceSnapshot: service.price,
        durationSnapshot: service.durationMinutes,
        notes: input.notes,
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: created.id,
        type: "CREATED",
        newValue: JSON.stringify({ status: "PENDING", staffId: input.staffId, startsAt: input.startsAt }),
        actorType: input.actor.type,
        actorUserId: input.actor.userId,
        actorStaffId: input.actor.staffId,
      },
    });
  await appointmentAudit(tx, {
    businessId: input.businessId,
    actorUserId: input.actor.userId,
    actorType: input.actor.type === "CLIENT" ? "SYSTEM" : input.actor.type,
    resource: "appointment",
    resourceId: created.id,
    action: "create",
    newValue: created,
  });
    return created;
  });

  await eventBus.emit("appointment.created", input.businessId, { appointment });

  return appointment;
}

export interface ChangeStatusInput {
  appointmentId: string;
  newStatus: AppointmentStatus;
  actor: { type: "USER" | "AI" | "SYSTEM"; userId?: string; staffId?: string };
  reason?: string;
}

/**
 * Section 7 — the ONLY way an appointment's status changes. There is no
 * scheduled job anywhere in the system that calls this to mark something
 * COMPLETED just because its date passed; that ambiguity is handled by
 * attentionScanner.ts, which flags for a human instead.
 */
export async function changeAppointmentStatus(input: ChangeStatusInput) {
  // Capture intent once. A serialization retry must not reinterpret a stale
  // request as permission to transition from a newer status.
  const expected = await prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  const { updated, appointment } = await appointmentTransaction(async (tx) => {
  const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  assertUnchanged(appointment, expected);

  if (!isTransitionAllowed(appointment.status, input.newStatus)) {
    throw new InvalidStatusTransitionError(appointment.status, input.newStatus);
  }

  const changed = await tx.appointment.updateMany({
    where: { id: appointment.id, businessId: appointment.businessId, status: appointment.status, updatedAt: appointment.updatedAt },
    data: {
      status: input.newStatus,
      // Resolving the status also resolves any pending "needs attention" flag.
      needsAttention: false,
      attentionReason: null,
    },
  });
  if (changed.count !== 1) throw new AppointmentConflictError("Appointment changed. Please refresh and try again.");
  const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });

  await tx.appointmentEvent.create({
    data: {
      appointmentId: appointment.id,
      type: input.newStatus === "CANCELLED" ? "CANCELLATION" : input.newStatus === "COMPLETED" ? "COMPLETED" : input.newStatus === "NO_SHOW" ? "NO_SHOW_MARKED" : "STATUS_CHANGED",
      previousValue: JSON.stringify({ status: appointment.status }),
      newValue: JSON.stringify({ status: input.newStatus }),
      reason: input.reason,
      actorType: input.actor.type,
      actorUserId: input.actor.userId,
      actorStaffId: input.actor.staffId,
    },
  });

  if (appointment.needsAttention) {
    await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        type: "ATTENTION_RESOLVED",
        actorType: input.actor.type,
        actorUserId: input.actor.userId,
      },
    });
  }

  await appointmentAudit(tx, {
    businessId: appointment.businessId,
    actorUserId: input.actor.userId,
    actorType: input.actor.type,
    resource: "appointment",
    resourceId: appointment.id,
    action: "status_change",
    previousValue: { status: appointment.status },
    newValue: { status: input.newStatus },
  });
  return { updated, appointment };
  });

  await eventBus.emit("appointment.status_changed", appointment.businessId, {
    appointment: updated,
    previousStatus: appointment.status,
  });
  if (input.newStatus === "COMPLETED") {
    await eventBus.emit("appointment.completed", appointment.businessId, { appointment: updated });
  }
  if (input.newStatus === "CANCELLED") {
    await eventBus.emit("appointment.cancelled", appointment.businessId, { appointment: updated });
  }

  return updated;
}

export interface RescheduleInput {
  appointmentId: string;
  newStartsAt: Date;
  actor: { type: "USER" | "AI" | "SYSTEM"; userId?: string; staffId?: string };
}

export async function rescheduleAppointment(input: RescheduleInput) {
  assertValidDate(input.newStartsAt, "Appointment start time");
  const expected = await prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  const updated = await appointmentTransaction(async (tx) => {
  const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  assertMovable(appointment.status);
  assertUnchanged(appointment, expected);

  // endsAt-startsAt already snapshots the service duration plus post-buffer.
  const durationWithBuffer = (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000;
  const newEndsAt = new Date(input.newStartsAt.getTime() + durationWithBuffer * 60_000);

  const availability = await checkStaffAvailability({
    serviceId: appointment.serviceId,
    staffId: appointment.staffId,
    businessId: appointment.businessId,
    startsAt: input.newStartsAt,
    endsAt: newEndsAt,
    locationType: appointment.locationType,
    travelBufferMins: appointment.travelBufferMins,
    excludeAppointmentId: appointment.id,
  }, tx);
  if (!availability.available) {
    throw new AppointmentConflictError(`Cannot reschedule to this slot: ${availability.reason}`);
  }

    const changed = await tx.appointment.updateMany({
      where: { id: appointment.id, businessId: appointment.businessId, status: appointment.status, updatedAt: appointment.updatedAt },
      data: { startsAt: input.newStartsAt, endsAt: newEndsAt },
    });
    if (changed.count !== 1) throw new AppointmentConflictError();
    const rescheduled = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        type: "RESCHEDULED",
        previousValue: JSON.stringify({ startsAt: appointment.startsAt }),
        newValue: JSON.stringify({ startsAt: input.newStartsAt }),
        actorType: input.actor.type,
        actorUserId: input.actor.userId,
        actorStaffId: input.actor.staffId,
      },
    });
  await appointmentAudit(tx, {
    businessId: appointment.businessId,
    actorUserId: input.actor.userId,
    actorType: input.actor.type,
    resource: "appointment",
    resourceId: appointment.id,
    action: "reschedule",
    previousValue: { startsAt: appointment.startsAt },
    newValue: { startsAt: input.newStartsAt },
  });
    return rescheduled;
  });

  await eventBus.emit("appointment.rescheduled", updated.businessId, { appointment: updated });

  return updated;
}

export interface ReassignStaffInput {
  appointmentId: string;
  newStaffId: string;
  reason?: string;
  actor: { type: "USER" | "AI" | "SYSTEM"; userId?: string };
}

/** Section 11: staff reassignment must be recorded and the client notified — never silent. */
export async function reassignAppointmentStaff(input: ReassignStaffInput) {
  const expected = await prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  const updated = await appointmentTransaction(async (tx) => {
  const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  assertMovable(appointment.status);
  assertUnchanged(appointment, expected);
  const staff = await tx.staff.findUnique({ where: { id: input.newStaffId } });
  if (!staff || staff.businessId !== appointment.businessId) {
    throw new Error("Staff member not found for this business");
  }
  if (staff.status !== "ACTIVE") {
    throw new Error("Staff member is not active");
  }
  if (appointment.locationType === "HOME" && !staff.homeServiceEligible) {
    throw new Error("Staff member is not eligible for home service");
  }
  const staffService = await tx.staffService.findUnique({
    where: { staffId_serviceId: { staffId: staff.id, serviceId: appointment.serviceId } },
  });
  if (!staffService) {
    throw new Error("Staff member is not qualified to perform this service");
  }

  const availability = await checkStaffAvailability({
    serviceId: appointment.serviceId,
    staffId: input.newStaffId,
    businessId: appointment.businessId,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    locationType: appointment.locationType,
    travelBufferMins: appointment.travelBufferMins,
    excludeAppointmentId: appointment.id,
  }, tx);
  if (!availability.available) {
    throw new AppointmentConflictError(`Cannot reassign to this staff member: ${availability.reason}`);
  }

    const changed = await tx.appointment.updateMany({
      where: { id: appointment.id, businessId: appointment.businessId, status: appointment.status, updatedAt: appointment.updatedAt },
      data: { staffId: input.newStaffId },
    });
    if (changed.count !== 1) throw new AppointmentConflictError();
    const reassigned = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        type: "REASSIGNED",
        previousValue: JSON.stringify({ staffId: appointment.staffId }),
        newValue: JSON.stringify({ staffId: input.newStaffId }),
        reason: input.reason,
        actorType: input.actor.type,
        actorUserId: input.actor.userId,
      },
    });
  await appointmentAudit(tx, {
    businessId: appointment.businessId,
    actorUserId: input.actor.userId,
    actorType: input.actor.type,
    resource: "appointment",
    resourceId: appointment.id,
    action: "reassign_staff",
    previousValue: { staffId: appointment.staffId },
    newValue: { staffId: input.newStaffId },
  });
    return reassigned;
  });

  // A dedicated event so a notification listener can send exactly the
  // "Ada is unavailable, reassigned to Mike" message from section 11 —
  // this fires regardless of *why* the reassignment happened.
  await eventBus.emit("appointment.reassigned", updated.businessId, {
    appointment: updated,
    previousStaffId: expected.staffId,
    reason: input.reason,
  });

  return updated;
}

export interface AcknowledgeAttentionInput {
  appointmentId: string;
  actor: { type: "USER" | "AI" | "SYSTEM"; userId?: string };
}

/**
 * Section 7's fifth resolution option, "Keep Pending": the owner looked at
 * a flagged appointment and confirmed nothing's actually wrong — it's
 * genuinely still pending. This is the one attention-resolution path that
 * ISN'T a status change (the state machine correctly rejects PENDING→PENDING
 * as a no-op transition), so it needs its own function rather than routing
 * through changeAppointmentStatus.
 */
export async function acknowledgeAttention(input: AcknowledgeAttentionInput) {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });

  if (!appointment.needsAttention) {
    return appointment; // nothing to resolve — idempotent rather than an error
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { needsAttention: false, attentionReason: null },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId: appointment.id,
      type: "ATTENTION_RESOLVED",
      reason: "Confirmed still pending — no change needed",
      actorType: input.actor.type,
      actorUserId: input.actor.userId,
    },
  });

  await writeAuditLog({
    businessId: appointment.businessId,
    actorUserId: input.actor.userId,
    actorType: input.actor.type,
    resource: "appointment",
    resourceId: appointment.id,
    action: "acknowledge_attention",
  });

  return updated;
}

function assertValidDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function assertLocationType(value: unknown): asserts value is LocationType {
  if (value !== "SALON" && value !== "HOME") {
    throw new Error("Location type must be SALON or HOME");
  }
}

function assertBookingChannel(value: unknown): asserts value is BookingChannel {
  if (!Object.values(BookingChannel).includes(value as BookingChannel)) {
    throw new Error("Booking channel is invalid");
  }
}
