jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { buildAssistantSystemPrompt } from "../assistantSystemPrompt";

describe("buildAssistantSystemPrompt", () => {
  it("includes the business name and the actor's role", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Big Kitchen Hair Studio" });

    const prompt = await buildAssistantSystemPrompt({ userId: "u1", role: "MANAGER", businessId: "biz_1" });

    expect(prompt).toContain("Big Kitchen Hair Studio");
    expect(prompt).toMatch(/Manager/);
  });

  it("mentions the current page when provided", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Big Kitchen" });

    const prompt = await buildAssistantSystemPrompt({ userId: "u1", role: "OWNER", businessId: "biz_1" }, "Reports");

    expect(prompt).toMatch(/viewing the Reports page/);
  });

  it("states the permission-inheritance hard rule explicitly", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Big Kitchen" });

    const prompt = await buildAssistantSystemPrompt({ userId: "u1", role: "STAFF", businessId: "biz_1" });

    expect(prompt).toMatch(/exactly the same permissions as this user/i);
    expect(prompt).toMatch(/never reveal data a denied call would have returned/i);
  });

  it("instructs the model to confirm before mutating actions and never claim false success", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Big Kitchen" });

    const prompt = await buildAssistantSystemPrompt({ userId: "u1", role: "OWNER", businessId: "biz_1" });

    expect(prompt).toMatch(/confirm/i);
    expect(prompt).toMatch(/never say something was done unless/i);
  });
});
