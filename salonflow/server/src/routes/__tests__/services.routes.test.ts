jest.mock("../../lib/prisma");
jest.mock("../../modules/services/serviceService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { servicesRouter } from "../services.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { createService, updateService } from "../../modules/services/serviceService";
import { buildService } from "../../test-utils/factories";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/services", servicesRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });
const managerToken = signToken({ sub: "mgr_1", businessId: "biz_1", role: "MANAGER" });
const otherBusinessToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/services", () => {
  it("STAFF cannot create a service", async () => {
    const res = await request(buildApp()).post("/api/services").set("Authorization", `Bearer ${staffToken}`).send({});
    expect(res.status).toBe(403);
    expect(createService).not.toHaveBeenCalled();
  });

  it("OWNER can create a service, scoped to their own business regardless of body content", async () => {
    (createService as jest.Mock).mockResolvedValue(buildService());

    const res = await request(buildApp())
      .post("/api/services")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Knotless Braids", price: 4000000, durationMinutes: 180, businessId: "biz_HACKED" });

    expect(res.status).toBe(201);
    expect(createService).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_1" }));
  });
});

describe("PUT /api/services/:id", () => {
  it("MANAGER can edit a service (role default includes edit, not create/delete)", async () => {
    (updateService as jest.Mock).mockResolvedValue(buildService({ price: 5000000 }));

    const res = await request(buildApp())
      .put("/api/services/svc_1")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ price: 5000000 });

    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/services/:id", () => {
  it("MANAGER cannot deactivate a service by default (delete not in MANAGER's default permission set)", async () => {
    const res = await request(buildApp()).delete("/api/services/svc_1").set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/services/:id", () => {
  it("403s across businesses even for a structurally valid OWNER token", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService({ businessId: "biz_1" }));

    const res = await request(buildApp()).get("/api/services/svc_1").set("Authorization", `Bearer ${otherBusinessToken}`);

    expect(res.status).toBe(403);
  });
});
