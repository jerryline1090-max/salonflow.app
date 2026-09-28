import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";

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
  await prisma.$transaction(
    hours.map((hour) =>
      prisma.businessHours.upsert({
        where: { businessId_dayOfWeek: { businessId, dayOfWeek: hour.dayOfWeek } },
        create: { businessId, ...hour },
        update: hour,
      }),
    ),
  );

  await writeAuditLog({
    businessId,
    actorUserId,
    resource: "settings",
    resourceId: businessId,
    action: "update_working_hours",
    newValue: hours,
  });
}
