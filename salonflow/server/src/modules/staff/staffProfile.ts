import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";

/**
 * A `Staff` row (skills, schedule, home-service eligibility) is distinct
 * from a `User` account (login, role, permissions) — see authService.ts's
 * `createTeamMember`. A staff member can exist operationally (on the
 * calendar, bookable) without ever logging into SalonFlow, and a `User`
 * can be linked to a `Staff` profile via `userId` when they do need login
 * access. This file only manages the operational profile.
 */

export interface CreateStaffInput {
  businessId: string;
  name: string;
  phone?: string;
  photoUrl?: string;
  skills?: string[];
  homeServiceEligible?: boolean;
  commissionPercent?: number;
  userId?: string; // links to an existing User account, if this staff member also logs in
  schedule?: { dayOfWeek: number; startTime: string; endTime: string; isOff?: boolean }[];
  serviceIds?: string[];
  actorUserId: string;
}

export async function createStaffProfile(input: CreateStaffInput) {
  if (input.userId) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || user.businessId !== input.businessId) {
      throw new Error("Linked user account not found for this business");
    }
  }
  if (input.serviceIds?.length) {
    const services = await prisma.service.findMany({ where: { id: { in: input.serviceIds }, businessId: input.businessId } });
    if (services.length !== input.serviceIds.length) {
      throw new Error("One or more services were not found for this business");
    }
  }

  const staff = await prisma.staff.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      phone: input.phone,
      photoUrl: input.photoUrl,
      skills: input.skills ?? [],
      homeServiceEligible: input.homeServiceEligible ?? false,
      commissionPercent: input.commissionPercent,
      userId: input.userId,
      schedule: input.schedule
        ? { create: input.schedule.map((s) => ({ ...s, isOff: s.isOff ?? false })) }
        : undefined,
      services: input.serviceIds ? { create: input.serviceIds.map((serviceId) => ({ serviceId })) } : undefined,
    },
    include: { schedule: true, services: true },
  });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "staff",
    resourceId: staff.id,
    action: "create_profile",
    newValue: staff,
  });

  return staff;
}

export interface UpdateStaffProfileInput {
  staffId: string;
  businessId: string;
  actorUserId: string;
  updates: Partial<{
    name: string;
    phone: string;
    photoUrl: string;
    skills: string[];
    homeServiceEligible: boolean;
    commissionPercent: number;
  }>;
}

export async function updateStaffProfile(input: UpdateStaffProfileInput) {
  const existing = await prisma.staff.findUniqueOrThrow({ where: { id: input.staffId } });
  if (existing.businessId !== input.businessId) {
    throw new Error("Staff member not found for this business");
  }

  const updated = await prisma.staff.update({ where: { id: input.staffId }, data: input.updates });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "staff",
    resourceId: existing.id,
    action: "update_profile",
    previousValue: existing,
    newValue: updated,
  });

  return updated;
}

export interface SetStaffScheduleInput {
  staffId: string;
  businessId: string;
  actorUserId: string;
  schedule: { dayOfWeek: number; startTime: string; endTime: string; isOff?: boolean }[];
}

/** Replaces the staff member's weekly schedule — the same schedule `staffAvailability.ts` checks against for every booking. */
export async function setStaffSchedule(input: SetStaffScheduleInput) {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: input.staffId } });
  if (staff.businessId !== input.businessId) {
    throw new Error("Staff member not found for this business");
  }

  await prisma.$transaction(
    input.schedule.map((s) =>
      prisma.staffSchedule.upsert({
        where: { staffId_dayOfWeek: { staffId: input.staffId, dayOfWeek: s.dayOfWeek } },
        create: { staffId: input.staffId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, isOff: s.isOff ?? false },
        update: { startTime: s.startTime, endTime: s.endTime, isOff: s.isOff ?? false },
      })
    )
  );

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "staff",
    resourceId: staff.id,
    action: "update_schedule",
    newValue: input.schedule,
  });

  return prisma.staffSchedule.findMany({ where: { staffId: input.staffId }, orderBy: { dayOfWeek: "asc" } });
}

export interface SetStaffServicesInput {
  staffId: string;
  businessId: string;
  actorUserId: string;
  serviceIds: string[];
}

/** Replaces which services a staff member is qualified to perform — the same link the AI Receptionist's `findQualifiedStaffForService` reads. */
export async function setStaffServices(input: SetStaffServicesInput) {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: input.staffId } });
  if (staff.businessId !== input.businessId) {
    throw new Error("Staff member not found for this business");
  }

  // Validate every service actually belongs to this business first — a
  // typo'd or cross-tenant ID must never silently link into StaffService.
  const services = await prisma.service.findMany({ where: { id: { in: input.serviceIds }, businessId: input.businessId } });
  if (services.length !== input.serviceIds.length) {
    throw new Error("One or more services were not found for this business");
  }

  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { staffId: input.staffId } }),
    prisma.staffService.createMany({ data: input.serviceIds.map((serviceId) => ({ staffId: input.staffId, serviceId })) }),
  ]);

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "staff",
    resourceId: staff.id,
    action: "update_services",
    newValue: input.serviceIds,
  });

  return prisma.staffService.findMany({ where: { staffId: input.staffId }, include: { service: true } });
}
