jest.mock("../../../lib/prisma");
jest.mock("../../clients/clientIdentity");

import { prisma } from "../../../lib/prisma";
import { resolveOrCreateClientForChannel } from "../../clients/clientIdentity";
import {
  ingestInboundMessage,
  markEscalated,
  takeOverConversation,
  returnConversationToAi,
  appendOutboundMessage,
} from "../conversationEngine";
import { UnifiedInboundMessage } from "../../ai/channels/types";

const baseMsg: UnifiedInboundMessage = {
  channel: "WHATSAPP",
  businessId: "biz_1",
  externalConversationId: "phone123:2348000000000",
  externalUserId: "2348000000000",
  externalMessageId: "wamid.1",
  type: "TEXT",
  text: "I want braids tomorrow",
  receivedAt: new Date("2026-08-26T10:00:00Z"),
};

describe("ingestInboundMessage", () => {
  it("upserts one conversation per (business, channel, externalConversationId) — never a duplicate thread", async () => {
    const conversation = { id: "conv_1", businessId: "biz_1", clientId: null };
    (prisma.conversation.upsert as jest.Mock).mockResolvedValue(conversation);
    (resolveOrCreateClientForChannel as jest.Mock).mockResolvedValue({ id: "client_1" });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({ ...conversation, clientId: "client_1" });
    (prisma.conversationMessage.create as jest.Mock).mockResolvedValue({ id: "msg_1", text: baseMsg.text });

    await ingestInboundMessage(baseMsg);

    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId_channel_externalConversationId: {
            businessId: "biz_1",
            channel: "WHATSAPP",
            externalConversationId: "phone123:2348000000000",
          },
        },
      })
    );
  });

  it("resolves a client for a brand-new conversation and links it", async () => {
    (prisma.conversation.upsert as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1", clientId: null });
    (resolveOrCreateClientForChannel as jest.Mock).mockResolvedValue({ id: "client_new" });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({ id: "conv_1", clientId: "client_new" });
    (prisma.conversationMessage.create as jest.Mock).mockResolvedValue({ id: "msg_1" });

    const { conversation } = await ingestInboundMessage(baseMsg);

    expect(resolveOrCreateClientForChannel).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "biz_1", channel: "WHATSAPP", externalUserId: "2348000000000" })
    );
    expect(conversation.clientId).toBe("client_new");
  });

  it("does not re-resolve a client for a conversation that already has one", async () => {
    (prisma.conversation.upsert as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1", clientId: "client_existing" });
    (prisma.conversationMessage.create as jest.Mock).mockResolvedValue({ id: "msg_2" });

    await ingestInboundMessage(baseMsg);

    expect(resolveOrCreateClientForChannel).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("returns an existing provider message rather than creating a duplicate", async () => {
    (prisma.conversation.upsert as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1", clientId: "client_1" });
    (prisma.conversationMessage.findFirst as jest.Mock).mockResolvedValue({ id: "existing_msg" });

    const result = await ingestInboundMessage(baseMsg);

    expect(result.duplicate).toBe(true);
    expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
  });

  it("marks a voice/image message PENDING for processing, but a text message needs none", async () => {
    (prisma.conversation.upsert as jest.Mock).mockResolvedValue({ id: "conv_1", businessId: "biz_1", clientId: "client_1" });
    (prisma.conversationMessage.create as jest.Mock).mockResolvedValue({ id: "msg_3" });

    await ingestInboundMessage(baseMsg); // TEXT
    let dataArg = (prisma.conversationMessage.create as jest.Mock).mock.calls[0][0].data;
    expect(dataArg.mediaProcessingStatus).toBeNull();

    await ingestInboundMessage({ ...baseMsg, type: "VOICE", mediaSecureRef: "local:abc", text: undefined });
    dataArg = (prisma.conversationMessage.create as jest.Mock).mock.calls[1][0].data;
    expect(dataArg.mediaProcessingStatus).toBe("PENDING");
  });
});

describe("conversation status transitions", () => {
  it("markEscalated sets status ESCALATED with a reason", async () => {
    (prisma.conversation.update as jest.Mock).mockResolvedValue({ id: "conv_1", status: "ESCALATED" });

    await markEscalated("conv_1", "AI was not confident about the client's request");

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { status: "ESCALATED", escalationReason: "AI was not confident about the client's request" },
    });
  });

  it("takeOverConversation moves status to HUMAN_HANDLING", async () => {
    (prisma.conversation.update as jest.Mock).mockResolvedValue({ id: "conv_1", status: "HUMAN_HANDLING" });

    await takeOverConversation("conv_1");

    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: "conv_1" }, data: { status: "HUMAN_HANDLING" } });
  });

  it("returnConversationToAi clears the escalation reason", async () => {
    await returnConversationToAi("conv_1");

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { status: "AI_HANDLING", escalationReason: null },
    });
  });
});

describe("appendOutboundMessage", () => {
  it("records the AI's or staff's reply and bumps lastMessageAt", async () => {
    (prisma.conversationMessage.create as jest.Mock).mockResolvedValue({ id: "out_1" });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({ id: "conv_1" });

    await appendOutboundMessage("conv_1", { text: "Sure, tomorrow at 2 works!", actorType: "AI" });

    expect(prisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ direction: "OUTBOUND", actorType: "AI", text: "Sure, tomorrow at 2 works!" }),
      })
    );
  });
});
