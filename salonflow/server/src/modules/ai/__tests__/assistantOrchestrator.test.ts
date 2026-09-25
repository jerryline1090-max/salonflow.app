jest.mock("../../../lib/prisma");
jest.mock("../assistantTools");

import { prisma } from "../../../lib/prisma";
import * as tools from "../assistantTools";
import { askAssistant } from "../assistantOrchestrator";
import { AiModelClient, ModelDecision } from "../aiModelClient";

const ownerActor = { userId: "owner_1", role: "OWNER" as const, businessId: "biz_1" };

class ScriptedModelClient implements AiModelClient {
  private calls = 0;
  constructor(private script: ModelDecision[]) {}
  async decide(): Promise<ModelDecision> {
    const decision = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    return decision;
  }
}

beforeEach(() => {
  (prisma.assistantConversation.upsert as jest.Mock).mockResolvedValue({ id: "conv_1" });
  (prisma.assistantMessage.create as jest.Mock).mockResolvedValue({ id: "msg_1" });
  (prisma.assistantMessage.findMany as jest.Mock).mockResolvedValue([]);
});

describe("askAssistant", () => {
  it("executes a tool call then returns the model's final reply", async () => {
    (tools.getClientCount as jest.Mock).mockResolvedValue(42);
    const modelClient = new ScriptedModelClient([
      { kind: "tool_call", tool: "getClientCount", args: {} },
      { kind: "reply", text: "You have 42 clients." },
    ]);

    const result = await askAssistant({ actor: ownerActor, message: "How many clients do we have?" }, modelClient);

    expect(tools.getClientCount).toHaveBeenCalledWith(ownerActor);
    expect(result.reply).toBe("You have 42 clients.");
    expect(prisma.assistantMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "ai", text: "You have 42 clients." }) })
    );
  });

  it("surfaces a permission denial as a tool error so the model can relay it plainly", async () => {
    (tools.getRevenueReport as jest.Mock).mockRejectedValue(new Error("Actor lacks 'view' permission on 'reports'"));
    const modelClient = new ScriptedModelClient([
      { kind: "tool_call", tool: "getRevenueReport", args: { from: "2026-08-01", to: "2026-08-31" } },
      { kind: "reply", text: "You don't have permission to view Reports — ask an owner or manager." },
    ]);

    const staffActor = { userId: "staff_1", role: "STAFF" as const, businessId: "biz_1" };
    const result = await askAssistant({ actor: staffActor, message: "Why is revenue lower today?" }, modelClient);

    expect(result.reply).toMatch(/don't have permission/i);
  });

  it("persists the user's message with its page context", async () => {
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Sure!" }]);

    await askAssistant({ actor: ownerActor, message: "How do I edit an appointment?", currentPage: "Appointments" }, modelClient);

    expect(prisma.assistantMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "user", text: "How do I edit an appointment?", pageContext: "Appointments" }),
      })
    );
  });

  it("replies plainly (not a fake escalation) when the model client isn't configured", async () => {
    const modelClient = new ScriptedModelClient([{ kind: "escalate", reason: "No AI model client configured for this deployment yet" }]);

    const result = await askAssistant({ actor: ownerActor, message: "What's our revenue?" }, modelClient);

    expect(result.reply).toMatch(/isn't fully set up yet/i);
  });

  it("never spins forever — force-resolves with a plain fallback after the iteration cap", async () => {
    (tools.getClientCount as jest.Mock).mockResolvedValue(1);
    const modelClient = new ScriptedModelClient([{ kind: "tool_call", tool: "getClientCount", args: {} }]);

    const result = await askAssistant({ actor: ownerActor, message: "..." }, modelClient);

    expect(result.reply).toMatch(/wasn't able to work that out/i);
  });

  it("reuses the same conversation thread across multiple questions from the same user", async () => {
    const modelClient = new ScriptedModelClient([{ kind: "reply", text: "Sure!" }]);

    await askAssistant({ actor: ownerActor, message: "Hi" }, modelClient);

    expect(prisma.assistantConversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId_userId: { businessId: "biz_1", userId: "owner_1" } } })
    );
  });
});
