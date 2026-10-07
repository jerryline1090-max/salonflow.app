import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";
import { parseWrite, businessHoursWrite } from "../../core/writeBoundary";

export interface BusinessHoursInput {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

// This is the single persistence operation used by Settings and onboarding.
// Callers own any workflow-specific validation and progression.
export async function saveBusinessHours(
  businessId: string,
  actorUserId: string,
  hours: BusinessHoursInput[],
) {
  const rows = parseWrite(businessHoursWrite, hours);
  await prisma.$transaction(
    rows.map((hour) =>
      prisma.businessHours.upsert({
        where: { businessId_dayOfWeek: { businessId, dayOfWeek: hour.dayOfWeek } },
        create: { businessId, dayOfWeek: hour.dayOfWeek, openTime: hour.openTime, closeTime: hour.closeTime, isClosed: hour.isClosed },
        update: { openTime: hour.openTime, closeTime: hour.closeTime, isClosed: hour.isClosed },
      }),
    ),
  );

  await writeAuditLog({
    businessId,
    actorUserId,
    resource: "settings",
    resourceId: businessId,
    action: "update_working_hours",
    newValue: rows,
  });
}
