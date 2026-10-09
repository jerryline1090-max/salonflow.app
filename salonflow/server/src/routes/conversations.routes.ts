import { Router } from "express";
import { requirePublicMessaging } from "../middleware/publicMessaging";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { appendOutboundMessage, takeOverConversation, returnConversationToAi } from "../modules/conversations/conversationEngine";
import { sendToClientChannel } from "../modules/notifications/channelMessenger";

export const conversationsRouter = Router();

/**
 * Section 19 of the multi-channel spec: conversation history — channel,
 * client, every message (text/transcription/media reference), AI actions,
 * escalations — visible to authorized SalonFlow users. Nothing here is a
 * separate "AI inbox" system; it's the same Conversation/ConversationMessage
 * tables the orchestrator writes to.
 */

conversationsRouter.get("/", requirePermission("conversations", "view"), async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { businessId: req.actor!.businessId },
    orderBy: { lastMessageAt: "desc" },
    include: { client: true },
  });
  res.json(conversations);
});

conversationsRouter.get("/:id", requirePermission("conversations", "view"), async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { client: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  try {
    assertBelongsToBusiness(req.actor!, conversation.businessId, "conversation");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(conversation);
});

// Section 14/19: a staff member steps in. The AI stops autonomously acting
// on this conversation the moment this is called (see receptionistOrchestrator.ts's
// HUMAN_HANDLING check) — no race where both a human and the AI reply at once.
conversationsRouter.post("/:id/takeover", requirePermission("conversations", "edit"), async (req, res) => {
  try {
    const existing = await prisma.conversation.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "conversation");
    const updated = await takeOverConversation(req.params.id);
    res.json(updated);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

conversationsRouter.post("/:id/return-to-ai", requirePermission("conversations", "edit"), async (req, res) => {
  try {
    const existing = await prisma.conversation.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "conversation");
    const updated = await returnConversationToAi(req.params.id);
    res.json(updated);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// A human's reply, sent back through whichever channel the conversation is
// actually on — never a parallel "staff messaging system" separate from the
// client's real WhatsApp/Instagram thread.
conversationsRouter.post("/:id/reply", requirePublicMessaging, requirePermission("conversations", "edit"), async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, conversation.businessId, "conversation");

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    await appendOutboundMessage(conversation.id, { text, actorType: "STAFF" });

    const sendResult = await sendToClientChannel(
      conversation.businessId,
      conversation.channel,
      conversation.externalConversationId,
      conversation.externalUserId,
      text
    );

    res.json({ success: sendResult.success, error: sendResult.error });
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});
