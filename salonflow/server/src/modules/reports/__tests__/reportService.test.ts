jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { getRevenueReport, getStaffPerformanceReport } from "../reportService";

describe("report metric semantics", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const to = new Date("2026-01-31T23:59:59.999Z");

  it("uses PAID payments for collected revenue and appointment balances for outstanding", async () => {
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 5_000 }, _count: 1 });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([
      { priceSnapshot: 4_000, payments: [{ amount: 1_500 }] },
      { priceSnapshot: 2_000, payments: [] },
      { priceSnapshot: 1_000, payments: [{ amount: 1_500 }] },
    ]);

    await expect(getRevenueReport("biz_1", from, to)).resolves.toEqual({
      totalRevenue: 5_000,
      paidTransactionCount: 1,
      outstandingAmount: 4_500,
    });
  });

  it("labels staff appointment value truthfully instead of collected revenue", async () => {
    (prisma.appointment.groupBy as jest.Mock).mockResolvedValue([{ staffId: "staff_1", _count: { staffId: 2 }, _sum: { priceSnapshot: 7_000 } }]);
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "staff_1", name: "Ada" }]);

    await expect(getStaffPerformanceReport("biz_1", from, to)).resolves.toEqual([
      { staff: { id: "staff_1", name: "Ada" }, completedAppointments: 2, completedServiceValue: 7_000 },
    ]);
  });
});
