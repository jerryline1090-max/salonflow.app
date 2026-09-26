import { prisma } from "../../lib/prisma";
import { resolveOrCreateClientForChannel } from "../clients/clientIdentity";
import { UnifiedInboundMessage } from "../ai/channels/types";

/**
 * Section 2 + 9 of the multi-channel spec: WhatsApp text, WhatsApp voice,
 * Instagram image, etc. all enter through here and become rows in the
 * SAME Conversation/ConversationMessage tables. There is no per-channel
 * conversation store. This is also where "many messages = one request"
 * (section 9) becomes possible: because everything lands in one ordered
 * message list per conversation, the orchestrator can always look back at
 * the last N messages regardless of which channel or media type each was.
 */

export async function ingestInboundMessage(msg: UnifiedInboundMessage) {
  const conversation = await prisma.conversation.upsert({
    where: {
      businessId_channel_externalConversationId: {
        businessId: msg.businessId,
        channel: msg.channel,
        externalConversationId: msg.externalConversationId,
      },
    },
    create: {
      businessId: msg.businessId,
      channel: msg.channel,
      externalConversationId: msg.externalConversationId,
      externalUserId: msg.externalUserId,
      lastMessageAt: msg.receivedAt,
    },
    update: { lastMessageAt: msg.receivedAt },
  });

  let conversationWithClient = conversation;
  if (!conversation.clientId) {
    const client = await resolveOrCreateClientForChannel({
      businessId: msg.businessId,
      channel: msg.channel,
      externalUserId: msg.externalUserId,
    });
    conversationWithClient = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { clientId: client.id },
    });
  }

  // Providers retry webhooks. If this exact inbound message was already
  // persisted, do not let it reach the AI loop again and send a duplicate reply.
  if (msg.externalMessageId) {
    const existing = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversationWithClient.id, externalMessageId: msg.externalMessageId },
    });
    if (existing) return { conversation: conversationWithClient, message: existing, duplicate: true };
  }

  try {
    const message = await prisma.conversationMessage.create({
      data: {
        conversationId: conversationWithClient.id,
        direction: "INBOUND",
        actorType: "CLIENT",
        type: msg.type,
        text: msg.text ?? null, // caption for media, body for text
        mediaType: msg.mediaMimeType,
        mediaSecureRef: msg.mediaSecureRef,
        mediaProcessingStatus: msg.type === "TEXT" ? null : "PENDING",
        externalMessageId: msg.externalMessageId,
      },
    });
    return { conversation: conversationWithClient, message, duplicate: false };
  } catch (error) {
    if (!msg.externalMessageId || !isConversationMessageIdempotencyConflict(error)) throw error;
    const existing = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversationWithClient.id, externalMessageId: msg.externalMessageId },
    });
    // The unique index is the final authority. Only convert its exact race
    // condition into a no-op after confirming the matching tenant conversation.
    if (existing) return { conversation: conversationWithClient, message: existing, duplicate: true };
    throw error;
  }

}

function isConversationMessageIdempotencyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  return (
    Array.isArray(target) &&
    target.includes("conversationId") &&
    target.includes("externalMessageId")
  );
}

/** Recent context for the AI — oldest first, so it reads like the actual conversation. */
export async function getRecentContext(conversationId: string, limit = 20) {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return messages.reverse();
}

export async function updateMessageProcessing(
  messageId: string,
  update: { transcription?: string; mediaProcessingStatus: "PROCESSED" | "FAILED" | "SKIPPED" }
) {
  return prisma.conversationMessage.update({
    where: { id: messageId },
    data: update,
  });
}

export async function appendOutboundMessage(
  conversationId: string,
  input: { text: string; actorType: "AI" | "STAFF"; relatedAppointmentId?: string }
) {
  const [message] = await Promise.all([
    prisma.conversationMessage.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        actorType: input.actorType,
        type: "TEXT",
        text: input.text,
        relatedAppointmentId: input.relatedAppointmentId,
      },
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
  ]);
  return message;
}

/** Section 14: escalate — the AI stops autonomously acting, a human is notified with full context preserved. */
export async function markEscalated(conversationId: string, reason: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "ESCALATED", escalationReason: reason },
  });
}

/** Section 19: a staff member takes over the conversation from the AI. */
export async function takeOverConversation(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "HUMAN_HANDLING" },
  });
}

export async function returnConversationToAi(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "AI_HANDLING", escalationReason: null },
  });
}
