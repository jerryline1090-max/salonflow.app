jest.mock("../../lib/prisma");
jest.mock("../../modules/reputation/reputationService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { reputationRouter } from "../reputation.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { resolveReputationRequest } from "../../modules/reputation/reputationService";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/reputation", reputationRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });
const otherBusinessToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("GET /api/reputation", () => {
  it("STAFF cannot view feedback by default (owner/manager responsibility)", async () => {
    const res = await request(buildApp()).get("/api/reputation").set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("OWNER sees feedback scoped to their own business", async () => {
    (prisma.reputationRequest.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/reputation").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((prisma.reputationRequest.findMany as jest.Mock).mock.calls[0][0].where.businessId).toBe("biz_1");
  });
});

describe("POST /api/reputation/:id/resolve", () => {
  it("403s resolving feedback from a different business", async () => {
    (prisma.reputationRequest.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "req_1", businessId: "biz_1" });

    const res = await request(buildApp())
      .post("/api/reputation/req_1/resolve")
      .set("Authorization", `Bearer ${otherBusinessToken}`)
      .send({ notes: "Called them" });

    expect(res.status).toBe(403);
    expect(resolveReputationRequest).not.toHaveBeenCalled();
  });

  it("OWNER can resolve feedback within their own business", async () => {
    (prisma.reputationRequest.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "req_1", businessId: "biz_1" });
    (resolveReputationRequest as jest.Mock).mockResolvedValue({ id: "req_1", resolvedAt: new Date() });

    const res = await request(buildApp())
      .post("/api/reputation/req_1/resolve")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ notes: "Called the client, offered a discount" });

    expect(res.status).toBe(200);
    expect(resolveReputationRequest).toHaveBeenCalledWith("req_1", "biz_1", "owner_1", "Called the client, offered a discount");
  });
});
