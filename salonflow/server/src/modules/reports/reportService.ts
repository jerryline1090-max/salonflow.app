import { prisma } from "../../lib/prisma";

/**
 * Section 14: every number here is computed from Appointment/Payment/Client
 * rows at query time. There is no parallel "reporting" table that could
 * drift from the source of truth.
 */
export async function getRevenueReport(businessId: string, from: Date, to: Date) {
  // Revenue = actual PAID payments in range — a PENDING appointment existing
  // is never treated as revenue, per section 13.
  const paid = await prisma.payment.aggregate({
    where: { businessId, status: "PAID", paidAt: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: true,
  });

  const outstanding = await prisma.payment.aggregate({
    where: { businessId, status: { in: ["UNPAID", "PARTIAL"] }, createdAt: { gte: from, lte: to } },
    _sum: { amount: true },
  });

  return {
    totalRevenue: paid._sum.amount ?? 0,
    paidTransactionCount: paid._count,
    outstandingAmount: outstanding._sum.amount ?? 0,
  };
}

export async function getAppointmentOutcomeReport(businessId: string, from: Date, to: Date) {
  const [completed, cancelled, noShow, pendingPastDate] = await Promise.all([
    prisma.appointment.count({ where: { businessId, status: "COMPLETED", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.count({ where: { businessId, status: "CANCELLED", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.count({ where: { businessId, status: "NO_SHOW", startsAt: { gte: from, lte: to } } }),
    prisma.appointment.count({ where: { businessId, needsAttention: true } }),
  ]);

  return { completed, cancelled, noShow, needsAttentionCount: pendingPastDate };
}

export async function getPopularServicesReport(businessId: string, from: Date, to: Date, limit = 10) {
  const grouped = await prisma.appointment.groupBy({
    by: ["serviceId"],
    where: { businessId, status: "COMPLETED", startsAt: { gte: from, lte: to } },
    _count: { serviceId: true },
    orderBy: { _count: { serviceId: "desc" } },
    take: limit,
  });

  const services = await prisma.service.findMany({ where: { id: { in: grouped.map((g) => g.serviceId) } } });
  const serviceById = new Map(services.map((s) => [s.id, s]));

  return grouped.map((g) => ({
    service: serviceById.get(g.serviceId),
    completedCount: g._count.serviceId,
  }));
}

export async function getStaffPerformanceReport(businessId: string, from: Date, to: Date) {
  const grouped = await prisma.appointment.groupBy({
    by: ["staffId"],
    where: { businessId, status: "COMPLETED", startsAt: { gte: from, lte: to } },
    _count: { staffId: true },
    _sum: { priceSnapshot: true },
  });

  const staff = await prisma.staff.findMany({ where: { id: { in: grouped.map((g) => g.staffId) } } });
  const staffById = new Map(staff.map((s) => [s.id, s]));

  return grouped.map((g) => ({
    staff: staffById.get(g.staffId),
    completedAppointments: g._count.staffId,
    revenueGenerated: g._sum.priceSnapshot ?? 0,
  }));
}

/** Client retention: how many clients had more than one COMPLETED visit ever. */
export async function getClientRetentionReport(businessId: string) {
  const clients = await prisma.client.findMany({
    where: { businessId },
    select: { id: true, _count: { select: { appointments: { where: { status: "COMPLETED" } } } } },
  });

  const returning = clients.filter((c) => c._count.appointments > 1).length;
  const oneTime = clients.filter((c) => c._count.appointments === 1).length;
  const never = clients.filter((c) => c._count.appointments === 0).length;

  return { totalClients: clients.length, returning, oneTime, never };
}
