import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";
import { writeAuditLog } from "../../core/auditLog";

/**
 * Section 10: if a staff member becomes unavailable or is removed, SalonFlow
 * must not silently destroy or orphan their upcoming appointments. This
 * module detects affected appointments and raises them for the owner to
 * resolve (typically via reassignAppointmentStaff in appointmentService.ts).
 */

export interface SetStaffStatusInput {
  staffId: string;
  newStatus: "ACTIVE" | "INACTIVE" | "REMOVED";
  actorUserId: string;
}

export async function setStaffStatus(input: SetStaffStatusInput) {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: input.staffId } });

  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: {
      status: input.newStatus,
      removedAt: input.newStatus === "REMOVED" ? new Date() : null,
    },
  });

  await writeAuditLog({
    businessId: staff.businessId,
    actorUserId: input.actorUserId,
    resource: "staff",
    resourceId: staff.id,
    action: "status_change",
    previousValue: { status: staff.status },
    newValue: { status: input.newStatus },
  });

  if (input.newStatus === "REMOVED" || input.newStatus === "INACTIVE") {
    const affected = await getUpcomingAppointmentsForStaff(staff.id);

    if (affected.length > 0) {
      await eventBus.emit("staff.removed", staff.businessId, {
        staffId: staff.id,
        staffName: staff.name,
        newStatus: input.newStatus,
        affectedAppointmentIds: affected.map((a) => a.id),
        affectedCount: affected.length,
        // The owner reviews and reassigns each one explicitly — this event
        // never triggers an automatic reassignment.
      });
    }
  } else if (input.newStatus === "ACTIVE") {
    await eventBus.emit("staff.reactivated", staff.businessId, { staffId: staff.id });
  }

  return { staff: updated, affectedAppointments: input.newStatus === "ACTIVE" ? [] : await getUpcomingAppointmentsForStaff(staff.id) };
}

async function getUpcomingAppointmentsForStaff(staffId: string) {
  return prisma.appointment.findMany({
    where: {
      staffId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { gte: new Date() },
    },
    include: { client: true, service: true },
    orderBy: { startsAt: "asc" },
  });
}
