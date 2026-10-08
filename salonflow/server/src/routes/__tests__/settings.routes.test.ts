jest.mock("../../lib/prisma");
jest.mock("../../core/auditLog");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { settingsRouter } from "../settings.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/settings", settingsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "biz_1", timezone: "Africa/Lagos" });
  (prisma.business.update as jest.Mock).mockResolvedValue({ id: "biz_1" });
});

describe("PUT /api/settings timezone validation", () => {
  it.each(["Africa/Lagos", "Europe/London", "America/New_York"])("accepts valid IANA timezone %s", async (timezone) => {
    const res = await request(buildApp()).put("/api/settings").set("Authorization", `Bearer ${ownerToken}`).send({ timezone });
    expect(res.status).toBe(200);
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ data: { timezone } }));
  });

  it("rejects an invalid timezone before Prisma update", async () => {
    const res = await request(buildApp()).put("/api/settings").set("Authorization", `Bearer ${ownerToken}`).send({ timezone: "not-real" });
    expect(res.status).toBe(400);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });
});
