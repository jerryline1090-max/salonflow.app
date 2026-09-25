jest.mock("../../lib/prisma");
jest.mock("../../modules/ai/knowledgeBaseService");
jest.mock("../../modules/ai/aiKnowledge");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { knowledgeBaseRouter } from "../knowledgeBase.routes";
import { signToken } from "../../core/auth";
import { createKnowledgeBaseEntry } from "../../modules/ai/knowledgeBaseService";
import { promoteEscalationToKnowledgeBase } from "../../modules/ai/aiKnowledge";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/knowledge-base", knowledgeBaseRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/knowledge-base", () => {
  it("STAFF can view but not create knowledge base entries by default", async () => {
    const res = await request(buildApp())
      .post("/api/knowledge-base")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ topic: "parking", answer: "Free parking" });

    expect(res.status).toBe(403);
    expect(createKnowledgeBaseEntry).not.toHaveBeenCalled();
  });

  it("OWNER can create an entry, scoped to their own business", async () => {
    (createKnowledgeBaseEntry as jest.Mock).mockResolvedValue({ id: "kb_1" });

    const res = await request(buildApp())
      .post("/api/knowledge-base")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ topic: "parking", answer: "Free parking behind the building" });

    expect(res.status).toBe(201);
    expect(createKnowledgeBaseEntry).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_1" }));
  });
});

describe("POST /api/knowledge-base/promote-escalation", () => {
  it("turns a resolved escalation into a permanent knowledge base entry", async () => {
    (promoteEscalationToKnowledgeBase as jest.Mock).mockResolvedValue({ id: "kb_2", source: "ESCALATION_RESOLVED" });

    const res = await request(buildApp())
      .post("/api/knowledge-base/promote-escalation")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ topic: "products", question: "Do you use Brazilian human-hair bundles?", answer: "Yes, we do." });

    expect(res.status).toBe(201);
    expect(promoteEscalationToKnowledgeBase).toHaveBeenCalledWith(
      "biz_1",
      "products",
      "Do you use Brazilian human-hair bundles?",
      "Yes, we do."
    );
  });
});

describe("GET /api/knowledge-base", () => {
  it("returns entries scoped to the actor's own business", async () => {
    (prisma.knowledgeBaseEntry.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/knowledge-base").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((prisma.knowledgeBaseEntry.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ businessId: "biz_1" });
  });
});
