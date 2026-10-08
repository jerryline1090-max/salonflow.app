jest.mock("../../lib/prisma");
jest.mock("../../modules/reports/reportService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { reportsRouter } from "../reports.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { getRevenueReport } from "../../modules/reports/reportService";

function buildApp() {
  const app = express();
  app.use(authenticate);
  app.use("/api/reports", reportsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.business.findUnique as jest.Mock).mockResolvedValue({ timezone: "Africa/Lagos" });
  (getRevenueReport as jest.Mock).mockResolvedValue({ totalRevenue: 0 });
});

describe("report range validation", () => {
  it("accepts a valid explicit range", async () => {
    const res = await request(buildApp())
      .get("/api/reports/revenue?from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.999Z")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(getRevenueReport).toHaveBeenCalledWith("biz_1", expect.any(Date), expect.any(Date));
  });

  it.each(["from=not-a-date", "to=not-a-date", "from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z"])("rejects invalid report range: %s", async (query) => {
    const res = await request(buildApp()).get(`/api/reports/revenue?${query}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
    expect(getRevenueReport).not.toHaveBeenCalled();
  });

  it("uses the persisted business timezone for a day period rather than the browser timezone", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ timezone: "America/New_York" });
    const res = await request(buildApp()).get("/api/reports/revenue?days=7").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(prisma.business.findUnique).toHaveBeenCalledWith({ where: { id: "biz_1" }, select: { timezone: true } });
  });

  it("keeps the default range working when no range is supplied", async () => {
    const res = await request(buildApp()).get("/api/reports/revenue").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(getRevenueReport).toHaveBeenCalled();
  });
});
