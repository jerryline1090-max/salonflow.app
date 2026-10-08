jest.mock("../../lib/prisma");
jest.mock("../../modules/conversations/conversationEngine");
jest.mock("../../modules/ai/orchestratorFactory");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { conversationsRouter } from "../conversations.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { takeOverConversation } from "../../modules/conversations/conversationEngine";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/conversations", conversationsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });
const otherBusinessToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("GET /api/conversations", () => {
  it("STAFF cannot view the AI Receptionist inbox by default", async () => {
    const res = await request(buildApp()).get("/api/conversations").set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("OWNER sees conversations scoped to their own business", async () => {
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/conversations").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((prisma.conversation.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ businessId: "biz_1" });
  });
});

describe("GET /api/conversations/:id", () => {
  it("403s when the conversation belongs to a different business", async () => {
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1" });

    const res = await request(buildApp()).get("/api/conversations/conv_1").set("Authorization", `Bearer ${otherBusinessToken}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/conversations/:id/takeover", () => {
  it("lets an OWNER take over a conversation within their business", async () => {
    (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1" });
    (takeOverConversation as jest.Mock).mockResolvedValue({ id: "conv_1", status: "HUMAN_HANDLING" });

    const res = await request(buildApp()).post("/api/conversations/conv_1/takeover").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(takeOverConversation).toHaveBeenCalledWith("conv_1");
  });

  it("403s an attempt to take over another business's conversation", async () => {
    (prisma.conversation.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1" });

    const res = await request(buildApp())
      .post("/api/conversations/conv_1/takeover")
      .set("Authorization", `Bearer ${otherBusinessToken}`);

    expect(res.status).toBe(403);
    expect(takeOverConversation).not.toHaveBeenCalled();
  });
});
