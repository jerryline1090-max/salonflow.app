import { LocationType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createAppointment, changeAppointmentStatus, rescheduleAppointment } from "../appointments/appointmentService";
import { checkStaffAvailability, findNextAvailableSlots } from "../staff/staffAvailability";
import { resolveClientQuestion } from "./aiKnowledge";
import { markEscalated } from "../conversations/conversationEngine";
import { eventBus } from "../../core/eventBus";

/**
 * Section 7 (hard rule) + section 17 of the multi-channel spec: the AI
 * Receptionist never touches Prisma directly and never receives a raw
 * businessId/clientId argument it could manipulate — every function here
 * takes a trusted `ReceptionistContext` (resolved by the conversation
 * engine from the verified webhook/channel identity, not from anything the
 * model said) and closes over it. The model can only ever supply the
 * "content" arguments (serviceId, date/time, etc.) — never the scope.
 *
 * This is the client-facing equivalent of a Role in core/permissions.ts:
 * a fixed, deliberately narrow allowlist. Notably absent: reassigning an
 * appointment to a different staff member, viewing reports, editing
 * settings, or touching another client's data — those stay owner/manager
 * actions (see routes/appointments.routes.ts, which blocks STAFF from
 * reassignment for the same reason).
 */
export interface ReceptionistContext {
  businessId: string;
  clientId: string;
  conversationId: string;
}

export class NotYourAppointmentError extends Error {
  constructor() {
    super("This appointment does not belong to this client");
    this.name = "NotYourAppointmentError";
  }
}

async function assertOwnAppointment(ctx: ReceptionistContext, appointmentId: string) {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.businessId !== ctx.businessId || appointment.clientId !== ctx.clientId) {
    throw new NotYourAppointmentError();
  }
  return appointment;
}

export async function searchServices(ctx: ReceptionistContext, query?: string) {
  const services = await prisma.service.findMany({ where: { businessId: ctx.businessId, isActive: true } });
  if (!query) return services;
  const q = query.toLowerCase();
  return services.filter((s) => s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q));
}

export async function getService(ctx: ReceptionistContext, serviceId: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || service.businessId !== ctx.businessId) return null;
  return service;
}

export async function getBusinessHours(ctx: ReceptionistContext) {
  return prisma.businessHours.findMany({ where: { businessId: ctx.businessId }, orderBy: { dayOfWeek: "asc" } });
}

export async function findQualifiedStaffForService(ctx: ReceptionistContext, serviceId: string) {
  return prisma.staff.findMany({
    where: { businessId: ctx.businessId, status: "ACTIVE", services: { some: { serviceId } } },
  });
}

export async function checkSlotAvailability(
  ctx: ReceptionistContext,
  input: { staffId: string; serviceId: string; startsAt: Date; locationType: LocationType }
) {
  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || service.businessId !== ctx.businessId) {
    return { available: false, reason: "Service not found" };
  }
  const endsAt = new Date(input.startsAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000);
  return checkStaffAvailability({
    staffId: input.staffId,
    businessId: ctx.businessId,
    startsAt: input.startsAt,
    endsAt,
    locationType: input.locationType,
  });
}

/** Section 16/22: real alternatives, never an invented opening. */
export async function suggestNextAvailableSlots(
  ctx: ReceptionistContext,
  input: { serviceId: string; locationType: LocationType; staffId?: string; fromDate?: Date }
) {
  return findNextAvailableSlots({
    businessId: ctx.businessId,
    serviceId: input.serviceId,
    locationType: input.locationType,
    staffId: input.staffId,
    fromDate: input.fromDate ?? new Date(),
  });
}

/** Section 7 example flow, steps 10–13, delegated entirely to the real booking engine. */
export async function bookAppointment(
  ctx: ReceptionistContext,
  input: {
    serviceId: string;
    staffId: string;
    startsAt: Date;
    locationType: LocationType;
    homeAddress?: string;
    notes?: string;
  }
) {
  return createAppointment({
    businessId: ctx.businessId,
    clientId: ctx.clientId, // always the resolved conversation's client — never AI-supplied
    serviceId: input.serviceId,
    staffId: input.staffId,
    startsAt: input.startsAt,
    locationType: input.locationType,
    homeAddress: input.homeAddress,
    bookingChannel: "AI_RECEPTIONIST",
    notes: input.notes,
    actor: { type: "AI" },
  });
}

export async function getOwnAppointment(ctx: ReceptionistContext, appointmentId: string) {
  return assertOwnAppointment(ctx, appointmentId);
}

export async function listOwnUpcomingAppointments(ctx: ReceptionistContext) {
  return prisma.appointment.findMany({
    where: {
      businessId: ctx.businessId,
      clientId: ctx.clientId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: "asc" },
  });
}

export async function rescheduleOwnAppointment(ctx: ReceptionistContext, input: { appointmentId: string; newStartsAt: Date }) {
  await assertOwnAppointment(ctx, input.appointmentId);
  return rescheduleAppointment({
    appointmentId: input.appointmentId,
    newStartsAt: input.newStartsAt,
    actor: { type: "AI" },
  });
}

/** Section 7's "cancel where permitted" — always through the real state machine, never a raw delete. */
export async function cancelOwnAppointment(ctx: ReceptionistContext, input: { appointmentId: string; reason?: string }) {
  await assertOwnAppointment(ctx, input.appointmentId);
  return changeAppointmentStatus({
    appointmentId: input.appointmentId,
    newStatus: "CANCELLED",
    reason: input.reason ?? "Cancelled by client via AI Receptionist",
    actor: { type: "AI" },
  });
}

/** Section 6/8: only ever answers from real Service/KnowledgeBase data, escalates otherwise. */
export async function answerFromKnowledge(ctx: ReceptionistContext, question: string) {
  return resolveClientQuestion(ctx.businessId, question);
}

/** Section 14: explicit escalation tool the model can call when it decides it needs a human. */
export async function escalateToStaff(ctx: ReceptionistContext, input: { question: string; reason?: string }) {
  await markEscalated(ctx.conversationId, input.reason ?? input.question);
  await eventBus.emit("ai.escalation_needed", ctx.businessId, { question: input.question, conversationId: ctx.conversationId });
  return { escalated: true };
}
