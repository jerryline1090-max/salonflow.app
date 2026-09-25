jest.mock("../../modules/integrations/integrationService");

import express from "express";
import request from "supertest";
import { integrationsCallbackRouter } from "../integrationsCallback.routes";
import { signOAuthState } from "../../core/oauthState";
import { completeConnect } from "../../modules/integrations/integrationService";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations", integrationsCallbackRouter);
  return app;
}

describe("GET /api/integrations/:provider/callback", () => {
  it("surfaces a Meta-reported error without ever calling completeConnect", async () => {
    const res = await request(buildApp()).get("/api/integrations/whatsapp/callback").query({ error: "access_denied" });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/access_denied/);
    expect(completeConnect).not.toHaveBeenCalled();
  });

  it("400s when code or state is missing", async () => {
    const res = await request(buildApp()).get("/api/integrations/whatsapp/callback").query({ code: "abc" });
    expect(res.status).toBe(400);
  });

  it("rejects a tampered/invalid state token", async () => {
    const res = await request(buildApp()).get("/api/integrations/whatsapp/callback").query({ code: "abc", state: "garbage" });
    expect(res.status).toBe(400);
    expect(completeConnect).not.toHaveBeenCalled();
  });

  it("rejects when the state's provider doesn't match the URL's provider (cross-provider confusion)", async () => {
    const state = signOAuthState({ businessId: "biz_1", provider: "INSTAGRAM", actorUserId: "owner_1" });

    const res = await request(buildApp()).get("/api/integrations/whatsapp/callback").query({ code: "abc", state });

    expect(res.status).toBe(400);
    expect(completeConnect).not.toHaveBeenCalled();
  });

  it("completes the connection and shows a success page", async () => {
    const state = signOAuthState({ businessId: "biz_1", provider: "WHATSAPP_BUSINESS", actorUserId: "owner_1" });
    (completeConnect as jest.Mock).mockResolvedValue({ status: "CONNECTED" });

    const res = await request(buildApp()).get("/api/integrations/whatsapp/callback").query({ code: "auth_code_123", state });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Connected/);
    expect(completeConnect).toHaveBeenCalledWith("auth_code_123", "biz_1", "WHATSAPP_BUSINESS", expect.anything());
  });

  it("shows the candidate list when multiple accounts need the owner to pick one", async () => {
    const state = signOAuthState({ businessId: "biz_1", provider: "WHATSAPP_BUSINESS", actorUserId: "owner_1" });
    (completeConnect as jest.Mock).mockResolvedValue({
      status: "NEEDS_SETUP",
      candidates: [{ id: "phone_1", label: "+234 800 000 0001" }],
    });

    const res = await request(buildApp()).get("/api/integrations/whatsapp/callback").query({ code: "auth_code_123", state });

    expect(res.status).toBe(200);
    expect(res.text).toContain("+234 800 000 0001");
  });
});
