jest.mock("../../../lib/prisma");
jest.mock("../../ai/orchestratorFactory");

import { prisma } from "../../../lib/prisma";
import { buildWhatsAppDeps, buildInstagramDeps } from "../../ai/orchestratorFactory";
import { sendToClientChannel } from "../channelMessenger";

describe("sendToClientChannel", () => {
  it("returns failure immediately for the website channel — no push capability yet", async () => {
    const result = await sendToClientChannel("biz_1", "WEBSITE", "conv_ext", "user_ext", "hi");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no outbound push capability/i);
    expect(prisma.integration.findFirst).not.toHaveBeenCalled();
  });

  it("returns failure when there's no connected integration for the channel", async () => {
    (prisma.integration.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await sendToClientChannel("biz_1", "WHATSAPP", "conv_ext", "user_ext", "hi");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no connected/i);
  });

  it("sends via the WhatsApp adapter when connected", async () => {
    (prisma.integration.findFirst as jest.Mock).mockResolvedValue({ externalId: "phone_123", secretRef: "ref_1" });
    const sendOutbound = jest.fn().mockResolvedValue({ success: true });
    (buildWhatsAppDeps as jest.Mock).mockReturnValue({ channelAdapter: { sendOutbound } });

    const result = await sendToClientChannel("biz_1", "WHATSAPP", "phone_123:2348000000000", "2348000000000", "How was your visit?");

    expect(buildWhatsAppDeps).toHaveBeenCalledWith("phone_123", "ref_1");
    expect(sendOutbound).toHaveBeenCalledWith({
      externalConversationId: "phone_123:2348000000000",
      externalUserId: "2348000000000",
      text: "How was your visit?",
    });
    expect(result).toEqual({ success: true });
  });

  it("sends via the Instagram adapter when connected", async () => {
    (prisma.integration.findFirst as jest.Mock).mockResolvedValue({ externalId: "ig_1", secretRef: "ref_2" });
    const sendOutbound = jest.fn().mockResolvedValue({ success: true });
    (buildInstagramDeps as jest.Mock).mockReturnValue({ channelAdapter: { sendOutbound } });

    await sendToClientChannel("biz_1", "INSTAGRAM", "ig_1:user_1", "user_1", "hi");

    expect(buildInstagramDeps).toHaveBeenCalledWith("ig_1", "ref_2");
  });
});
