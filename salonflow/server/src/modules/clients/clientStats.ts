import { prisma } from "../../lib/prisma";

/**
 * Section 8: a future/pending/confirmed appointment must NEVER count toward
 * total visits. Only COMPLETED appointments count. This is computed at read
 * time from the single source of truth (Appointment.status) rather than
 * stored as an incrementing counter anywhere — so it can never drift, be
 * double-counted, or be pre-incremented for an appointment that later gets
 * cancelled.
 */
export async function getClientStats(clientId: string) {
  const [completedCount, cancelledCount, noShowCount, upcomingCount, lastCompleted] = await Promise.all([
    prisma.appointment.count({ where: { clientId, status: "COMPLETED" } }),
    prisma.appointment.count({ where: { clientId, status: "CANCELLED" } }),
    prisma.appointment.count({ where: { clientId, status: "NO_SHOW" } }),
    prisma.appointment.count({
      where: { clientId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: new Date() } },
    }),
    prisma.appointment.findFirst({
      where: { clientId, status: "COMPLETED" },
      orderBy: { startsAt: "desc" },
    }),
  ]);

  const totalSpent = await prisma.payment.aggregate({
    where: { clientId, status: "PAID" },
    _sum: { amount: true },
  });

  return {
    totalVisits: completedCount, // the ONLY definition of "visits" in the system
    cancelledCount,
    noShowCount,
    upcomingCount,
    lastVisitAt: lastCompleted?.startsAt ?? null,
    totalSpent: totalSpent._sum.amount ?? 0,
  };
}
