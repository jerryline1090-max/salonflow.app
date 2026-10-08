jest.mock("../../modules/ai/assistantOrchestrator");
jest.mock("../../modules/ai/orchestratorFactory");

import express from "express";
import request from "supertest";
import { authenticate } from "../../middleware/authenticate";
import { assistantRouter } from "../assistant.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { askAssistant } from "../../modules/ai/assistantOrchestrator";
import { resolveAssistantModelClient } from "../../modules/ai/orchestratorFactory";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/assistant", assistantRouter);
  return app;
}

const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });

describe("POST /api/assistant/ask", () => {
  it("401s with no token — but requires no specific permission beyond authentication", async () => {
    const res = await request(buildApp()).post("/api/assistant/ask").send({ message: "hi" });
    expect(res.status).toBe(401);
  });

  it("400s when message is missing", async () => {
    const res = await request(buildApp()).post("/api/assistant/ask").set("Authorization", `Bearer ${staffToken}`).send({});
    expect(res.status).toBe(400);
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it("any authenticated role (including STAFF) can reach the endpoint — permission boundaries live at the tool level", async () => {
    (resolveAssistantModelClient as jest.Mock).mockReturnValue({ decide: jest.fn() });
    (askAssistant as jest.Mock).mockResolvedValue({ reply: "Here's what I found." });

    const res = await request(buildApp())
      .post("/api/assistant/ask")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ message: "How do I edit an appointment?", currentPage: "Appointments" });

    expect(res.status).toBe(200);
    expect(askAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ message: "How do I edit an appointment?", currentPage: "Appointments" }),
      expect.anything()
    );
  });
});
jest.mock("../../lib/prisma");
