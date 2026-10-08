jest.mock("../../lib/prisma");
jest.mock("../../modules/clients/clientService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { clientsRouter } from "../clients.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { updateClient } from "../../modules/clients/clientService";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/clients", clientsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });
const otherBusinessToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("GET /api/clients", () => {
  it("returns clients scoped to the actor's own business", async () => {
    (prisma.client.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/clients").set("Authorization", `Bearer ${ownerToken}`);

    expect((prisma.client.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ businessId: "biz_1" });
  });

  it("uses a bounded deterministic page and returns pagination metadata", async () => {
    (prisma.client.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.client.count as jest.Mock).mockResolvedValue(101);
    const res = await request(buildApp()).get("/api/clients?page=2&limit=999").set("Authorization", `Bearer ${ownerToken}`);
    expect((prisma.client.findMany as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({ skip: 100, take: 100, orderBy: { createdAt: "desc" } }));
    expect(res.body.pagination).toEqual({ page: 2, limit: 100, total: 101, totalPages: 2 });
  });

  it("searches only within the authenticated business using a bounded query", async () => {
    (prisma.client.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.client.count as jest.Mock).mockResolvedValue(0);
    await request(buildApp()).get("/api/clients?q=Ada%20Braider&limit=20").set("Authorization", `Bearer ${ownerToken}`);
    const where = (prisma.client.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.businessId).toBe("biz_1");
    expect(where.OR).toHaveLength(3);
    expect((prisma.client.findMany as jest.Mock).mock.calls[0][0].take).toBe(20);
  });
});

describe("PUT /api/clients/:id", () => {
  it("STAFF cannot edit client info by default (view-only role default)", async () => {
    const res = await request(buildApp()).put("/api/clients/client_1").set("Authorization", `Bearer ${staffToken}`).send({ phone: "x" });
    expect(res.status).toBe(403);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("403s editing a client from a different business", async () => {
    (prisma.client.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "client_1", businessId: "biz_1" });

    const res = await request(buildApp())
      .put("/api/clients/client_1")
      .set("Authorization", `Bearer ${otherBusinessToken}`)
      .send({ phone: "234800" });

    expect(res.status).toBe(403);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("OWNER can update a client within their own business", async () => {
    (prisma.client.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "client_1", businessId: "biz_1" });
    (updateClient as jest.Mock).mockResolvedValue({ id: "client_1", phone: "234800" });

    const res = await request(buildApp())
      .put("/api/clients/client_1")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ phone: "234800" });

    expect(res.status).toBe(200);
    expect(updateClient).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client_1", businessId: "biz_1", updates: { phone: "234800" } })
    );
  });
});
