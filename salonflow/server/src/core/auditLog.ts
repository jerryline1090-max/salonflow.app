import { prisma } from "../lib/prisma";

export interface AuditEntryInput {
  businessId: string;
  actorUserId?: string;
  actorType?: "USER" | "AI" | "SYSTEM";
  resource: "appointment" | "payment" | "staff" | "settings" | "permission" | "integration" | "service" | "client" | "reputation_request";
  resourceId: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
}

/** Section 32: who / what / when / previous value / new value — for every important change. */
export async function writeAuditLog(input: AuditEntryInput) {
  return prisma.auditLog.create({
    data: {
      businessId: input.businessId,
      actorUserId: input.actorUserId,
      actorType: input.actorType ?? "USER",
      resource: input.resource,
      resourceId: input.resourceId,
      action: input.action,
      previousValue: input.previousValue !== undefined ? JSON.stringify(input.previousValue) : null,
      newValue: input.newValue !== undefined ? JSON.stringify(input.newValue) : null,
    },
  });
}
