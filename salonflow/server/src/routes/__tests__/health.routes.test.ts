jest.mock("../../lib/prisma");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { errorHandler } from "../../middleware/errorHandler";
import { healthRouter } from "../health.routes";

function buildApp() {
  const app = express();
  app.use(healthRouter);
  app.use(errorHandler);
  return app;
}

describe("health routes", () => {
  it("keeps liveness independent of Prisma", async () => {
    const response = await request(buildApp()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("reports readiness when the minimal database check succeeds", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ "?column?": 1 }]);
    const response = await request(buildApp()).get("/ready");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  it("returns a safe 503 when the database is unavailable", async () => {
    const { Prisma } = await import("@prisma/client");
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "5.18.0" }));
    const response = await request(buildApp()).get("/ready");
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/temporarily unavailable/i);
  });
});
