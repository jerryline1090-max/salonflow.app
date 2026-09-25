jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { buildDefaultSystemPrompt } from "../systemPrompt";

describe("buildDefaultSystemPrompt", () => {
  it("includes the actual business name", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Big Kitchen Hair Studio", mode: "BOTH" });

    const prompt = await buildDefaultSystemPrompt("biz_1");

    expect(prompt).toContain("Big Kitchen Hair Studio");
  });

  it("notes home-service-only mode accurately", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Mobile Glam", mode: "HOME_ONLY" });

    const prompt = await buildDefaultSystemPrompt("biz_1");

    expect(prompt).toMatch(/home-service only/i);
  });

  it("notes salon-only mode accurately", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Downtown Cuts", mode: "SALON_ONLY" });

    const prompt = await buildDefaultSystemPrompt("biz_1");

    expect(prompt).toMatch(/does not currently offer home service/i);
  });

  it("always states the core hard rules regardless of business config", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ name: "Any Salon", mode: "BOTH" });

    const prompt = await buildDefaultSystemPrompt("biz_1");

    expect(prompt).toMatch(/never invent/i);
    expect(prompt).toMatch(/escalate_to_staff/i);
    expect(prompt).toMatch(/never tell a client an appointment was booked/i);
  });

  it("falls back gracefully when the business can't be found", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(null);

    const prompt = await buildDefaultSystemPrompt("ghost_biz");

    expect(prompt).toContain("this salon");
  });
});
