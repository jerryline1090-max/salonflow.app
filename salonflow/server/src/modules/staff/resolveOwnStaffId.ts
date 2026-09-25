import { prisma } from "../../lib/prisma";

/**
 * Role defaults give STAFF "view"/"edit" on appointments (they need to work
 * with their own schedule), but that must never mean "any staff member can
 * see or change any other staff member's appointments". Both
 * routes/appointments.routes.ts and modules/ai/assistantTools.ts call this
 * exact function to scope a STAFF actor to their own appointments —
 * one check, used identically whether the request came from the UI or the
 * AI Assistant (section 27's hard rule, applied to this specific scoping
 * rule too).
 */
export async function resolveOwnStaffId(userId: string): Promise<string | null> {
  const staff = await prisma.staff.findUnique({ where: { userId } });
  return staff?.id ?? null;
}
