import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";
import { parseWrite, clientUpdate } from "../../core/writeBoundary";

/**
 * Client creation is simple enough to stay inline in clients.routes.ts's
 * POST handler. Updates get their own function because they need the same
 * tenant check + audit trail as every other mutation in the app — fixing a
 * client's phone number is a small change, but it's still a change worth
 * tracking (section 32).
 */
export interface UpdateClientInput {
  clientId: string;
  businessId: string;
  actorUserId: string;
  updates: Partial<{ name: string; phone: string; email: string; address: string; notes: string }>;
}

export async function updateClient(input: UpdateClientInput) {
  const fields = parseWrite(clientUpdate, input.updates);
  const existing = await prisma.client.findUniqueOrThrow({ where: { id: input.clientId } });
  if (existing.businessId !== input.businessId) {
    throw new Error("Client not found for this business");
  }

  const updated = await prisma.client.update({
    where: { id: input.clientId, businessId: input.businessId },
    data: { name: fields.name, phone: fields.phone, email: fields.email, address: fields.address, notes: fields.notes },
  });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "client",
    resourceId: existing.id,
    action: "update",
    previousValue: existing,
    newValue: updated,
  });

  return updated;
}
