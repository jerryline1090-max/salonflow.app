import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";

/**
 * Section 7 (hard rule): SalonFlow must NEVER automatically mark a pending
 * appointment "completed" just because its date has passed. Instead this
 * scanner (run on a schedule, e.g. hourly) flags the appointment and
 * notifies the owner/manager so a human decides what actually happened.
 *
 * This function performs zero status transitions. Its only writes are
 * `needsAttention` / `attentionReason` plus a history event — both purely
 * informational, both reversible the instant a human resolves it via
 * changeAppointmentStatus() or rescheduleAppointment().
 */
export async function scanForAppointmentsNeedingAttention(businessId?: string) {
  const now = new Date();

  const stalePending = await prisma.appointment.findMany({
    where: {
      businessId: businessId ?? undefined,
      status: { in: ["PENDING", "CONFIRMED"] },
      endsAt: { lt: now },
      needsAttention: false,
    },
    include: { client: true },
  });

  for (const appt of stalePending) {
    const reason = `Scheduled for ${appt.startsAt.toISOString()} but is still ${appt.status.toLowerCase()}.`;

    await prisma.appointment.update({
      where: { id: appt.id },
      data: { needsAttention: true, attentionReason: reason },
    });

    await prisma.appointmentEvent.create({
      data: {
        appointmentId: appt.id,
        type: "FLAGGED_NEEDS_ATTENTION",
        newValue: JSON.stringify({ reason }),
        actorType: "SYSTEM",
      },
    });

    await eventBus.emit("appointment.needs_attention", appt.businessId, {
      appointmentId: appt.id,
      clientName: appt.client.name,
      reason,
      // The four safe resolutions offered to the owner — see section 7.
      // The scanner itself never picks one.
      suggestedActions: ["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULE", "KEEP_PENDING"],
    });
  }

  return { flaggedCount: stalePending.length };
}
