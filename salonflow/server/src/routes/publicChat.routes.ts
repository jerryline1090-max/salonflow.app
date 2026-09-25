import { Router } from "express";
import { prisma } from "../lib/prisma";
import { WebsiteChannelAdapter } from "../modules/ai/channels/websiteAdapter";
import { handleUnifiedMessage } from "../modules/ai/receptionistOrchestrator";
import { LocalDevMediaStore } from "../modules/ai/mediaStore";
import { NotConfiguredSpeechToTextService } from "../modules/ai/speechToText";
import { NotConfiguredMediaUnderstandingService } from "../modules/ai/mediaUnderstanding";
import { resolveModelClient } from "../modules/ai/orchestratorFactory";
import { OrchestratorDeps } from "../modules/ai/receptionistOrchestrator";

export const publicChatRouter = Router();

const websiteChannelAdapter = new WebsiteChannelAdapter();
const websiteMediaStore = new LocalDevMediaStore();
const websiteSpeechToText = new NotConfiguredSpeechToTextService();
const websiteMediaUnderstanding = new NotConfiguredMediaUnderstandingService();

function buildWebsiteDeps(): OrchestratorDeps {
  // resolveModelClient() is re-evaluated per request (see orchestratorFactory.ts)
  // so this picks up ANTHROPIC_API_KEY being configured without a restart-order dependency.
  return {
    modelClient: resolveModelClient(),
    channelAdapter: websiteChannelAdapter,
    mediaStore: websiteMediaStore,
    speechToText: websiteSpeechToText,
    mediaUnderstanding: websiteMediaUnderstanding,
  };
}

/**
 * Public — identified by the salon's public chat key, never a user JWT.
 * The widget generates and persists its own anonymous `sessionId` client-side
 * (e.g. in memory/local storage) so the same visitor's messages thread into
 * one Conversation across the page session.
 *
 * NOTE: uses the raw Business id as the "key" for now. Before shipping the
 * actual embeddable widget, replace this with a dedicated, rotatable public
 * key — a business's internal database ID should not be a public-facing
 * credential.
 */
publicChatRouter.post("/:businessKey/chat", async (req, res) => {
  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.businessKey } });
    if (!business) return res.status(404).json({ error: "Unknown business" });

    const { sessionId, text } = req.body;
    if (!sessionId || !text) {
      return res.status(400).json({ error: "sessionId and text are required" });
    }

    const result = await handleUnifiedMessage(
      {
        channel: "WEBSITE",
        businessId: business.id,
        externalConversationId: `website:${sessionId}`,
        externalUserId: sessionId,
        externalMessageId: `web_${Date.now()}`,
        type: "TEXT",
        text,
        receivedAt: new Date(),
      },
      buildWebsiteDeps()
    );

    res.json({ reply: result.reply, escalated: Boolean(result.escalated) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
