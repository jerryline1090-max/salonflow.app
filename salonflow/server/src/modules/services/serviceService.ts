import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";

/**
 * Section 9 (master spec): services are centralized here — the booking
 * engine, the dashboard's service dropdown, and the AI Receptionist's
 * `searchServices` tool all read from this same table, nowhere else.
 *
 * Section 13: updating a service's price/duration here NEVER touches
 * already-booked appointments. That's not enforced in this file — it's
 * structural: Appointment.priceSnapshot/durationSnapshot are captured once
 * at booking time (appointmentService.ts) and never re-read from Service.
 */

export interface CreateServiceInput {
  businessId: string;
  name: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  price: number;
  durationMinutes: number;
  bufferMinutes?: number;
  availableAtSalon?: boolean;
  availableAtHome?: boolean;
  homeTravelBufferMins?: number;
  requiredSkills?: string[];
  actorUserId: string;
}

function assertValidServiceShape(input: {
  price: number;
  durationMinutes: number;
  availableAtSalon?: boolean;
  availableAtHome?: boolean;
}) {
  if (input.price < 0) throw new Error("Price cannot be negative");
  if (input.durationMinutes <= 0) throw new Error("Duration must be greater than zero minutes");
  if (input.availableAtSalon === false && input.availableAtHome === false) {
    throw new Error("A service must be available at the salon, at home, or both");
  }
}

export async function createService(input: CreateServiceInput) {
  assertValidServiceShape(input);

  const service = await prisma.service.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      description: input.description,
      category: input.category,
      imageUrl: input.imageUrl,
      price: input.price,
      durationMinutes: input.durationMinutes,
      bufferMinutes: input.bufferMinutes ?? 0,
      availableAtSalon: input.availableAtSalon ?? true,
      availableAtHome: input.availableAtHome ?? false,
      homeTravelBufferMins: input.homeTravelBufferMins,
      requiredSkills: input.requiredSkills ?? [],
    },
  });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "service",
    resourceId: service.id,
    action: "create",
    newValue: service,
  });

  return service;
}

export interface UpdateServiceInput {
  serviceId: string;
  businessId: string;
  actorUserId: string;
  updates: Partial<{
    name: string;
    description: string;
    category: string;
    imageUrl: string;
    price: number;
    durationMinutes: number;
    bufferMinutes: number;
    availableAtSalon: boolean;
    availableAtHome: boolean;
    homeTravelBufferMins: number;
    requiredSkills: string[];
    isActive: boolean;
  }>;
}

export async function updateService(input: UpdateServiceInput) {
  const existing = await prisma.service.findUniqueOrThrow({ where: { id: input.serviceId } });
  if (existing.businessId !== input.businessId) {
    throw new Error("Service not found for this business");
  }

  if (input.updates.price !== undefined || input.updates.durationMinutes !== undefined) {
    assertValidServiceShape({
      price: input.updates.price ?? existing.price,
      durationMinutes: input.updates.durationMinutes ?? existing.durationMinutes,
    });
  }
  const nextSalon = input.updates.availableAtSalon ?? existing.availableAtSalon;
  const nextHome = input.updates.availableAtHome ?? existing.availableAtHome;
  if (!nextSalon && !nextHome) {
    throw new Error("A service must be available at the salon, at home, or both");
  }

  const updated = await prisma.service.update({ where: { id: input.serviceId }, data: input.updates });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "service",
    resourceId: existing.id,
    action: "update",
    previousValue: existing,
    newValue: updated,
  });

  return updated;
}

/** Soft-delete only — a service with historical appointments must remain readable (its name, its snapshot values). */
export async function deactivateService(serviceId: string, businessId: string, actorUserId: string) {
  return updateService({ serviceId, businessId, actorUserId, updates: { isActive: false } });
}
