jest.mock("../../lib/prisma");
jest.mock("../../modules/integrations/integrationService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { integrationsRouter } from "../integrations.routes";
import { signToken } from "../../core/auth";
import { beginConnect, disconnectIntegration } from "../../modules/integrations/integrationService";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/integrations", integrationsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const managerToken = signToken({ sub: "mgr_1", businessId: "biz_1", role: "MANAGER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/integrations/:provider/connect", () => {
  it("MANAGER cannot initiate a connection (view-only by default)", async () => {
    const res = await request(buildApp()).post("/api/integrations/whatsapp/connect").set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
    expect(beginConnect).not.toHaveBeenCalled();
  });

  it("OWNER can start a connect flow and receives the authorization URL", async () => {
    (beginConnect as jest.Mock).mockResolvedValue("https://facebook.com/oauth/dialog?client_id=...");

    const res = await request(buildApp()).post("/api/integrations/whatsapp/connect").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authorizationUrl).toContain("facebook.com");
    expect(beginConnect).toHaveBeenCalledWith("biz_1", "WHATSAPP_BUSINESS", "owner_1");
  });

  it("400s on an unknown provider slug rather than crashing", async () => {
    const res = await request(buildApp()).post("/api/integrations/tiktok/connect").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/integrations/:provider/disconnect", () => {
  it("OWNER can disconnect an integration in their own business", async () => {
    (disconnectIntegration as jest.Mock).mockResolvedValue({ status: "DISCONNECTED" });

    const res = await request(buildApp()).post("/api/integrations/instagram/disconnect").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(disconnectIntegration).toHaveBeenCalledWith("biz_1", "INSTAGRAM", "owner_1", expect.anything());
  });
});
