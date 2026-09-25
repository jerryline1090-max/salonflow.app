jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { getClientStats } from "../clientStats";

describe("getClientStats", () => {
  it("counts totalVisits strictly from COMPLETED appointments, ignoring pending/confirmed upcoming ones", async () => {
    (prisma.appointment.count as jest.Mock)
      .mockResolvedValueOnce(3) // completedCount
      .mockResolvedValueOnce(1) // cancelledCount
      .mockResolvedValueOnce(0) // noShowCount
      .mockResolvedValueOnce(2); // upcomingCount (PENDING/CONFIRMED, future)

    const lastCompletedDate = new Date("2026-08-01T10:00:00Z");
    (prisma.appointment.findFirst as jest.Mock).mockResolvedValue({ startsAt: lastCompletedDate });
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 150_000 } });

    const stats = await getClientStats("client_1");

    // The key assertion for section 8: two upcoming (not-yet-happened)
    // appointments exist, but they contribute nothing to totalVisits.
    expect(stats.totalVisits).toBe(3);
    expect(stats.upcomingCount).toBe(2);
    expect(stats.cancelledCount).toBe(1);
    expect(stats.noShowCount).toBe(0);
    expect(stats.lastVisitAt).toEqual(lastCompletedDate);
    expect(stats.totalSpent).toBe(150_000);
  });

  it("returns zero visits for a client whose only appointment is still pending", async () => {
    (prisma.appointment.count as jest.Mock)
      .mockResolvedValueOnce(0) // completedCount
      .mockResolvedValueOnce(0) // cancelledCount
      .mockResolvedValueOnce(0) // noShowCount
      .mockResolvedValueOnce(1); // upcomingCount
    (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } });

    const stats = await getClientStats("client_1");

    expect(stats.totalVisits).toBe(0);
    expect(stats.lastVisitAt).toBeNull();
    expect(stats.totalSpent).toBe(0);
  });
});
