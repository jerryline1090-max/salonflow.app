import { ConversationChannel } from "@prisma/client";
import { publicMessagingEnabled, MESSAGING_UNAVAILABLE } from "../../middleware/publicMessaging";
import { prisma } from "../../lib/prisma";
import { buildWhatsAppDeps, buildInstagramDeps } from "../ai/orchestratorFactory";

export interface ChannelMessengerResult {
  success: boolean;
  error?: string;
}

/**
 * Sends a message to a client through one of their connected channels,
 * reusing the exact same channel adapters the AI Receptionist uses to
 * reply — there's no separate "outbound messaging system" for the
 * reputation engine or for a staff member's manual reply
 * (conversations.routes.ts) to build on top of.
 */
export async function sendToClientChannel(
  businessId: string,
  channel: ConversationChannel,
  externalConversationId: string,
  externalUserId: string,
  text: string
): Promise<ChannelMessengerResult> {
  if (!publicMessagingEnabled(process.env.PUBLIC_MESSAGING_ENABLED)) return { success: false, error: MESSAGING_UNAVAILABLE };
  if (channel === "WEBSITE") {
    // Section 1C: website chat is request/response only for now — there's
    // no push capability to proactively message a website visitor later.
    return { success: false, error: "The website channel has no outbound push capability yet" };
  }

  const provider = channel === "WHATSAPP" ? "WHATSAPP_BUSINESS" : "INSTAGRAM";
  const integration = await prisma.integration.findFirst({ where: { businessId, provider, status: "CONNECTED" } });
  if (!integration?.externalId) {
    return { success: false, error: `No connected ${provider} integration for this business` };
  }

  const deps =
    channel === "WHATSAPP"
      ? buildWhatsAppDeps(integration.externalId, integration.secretRef ?? "")
      : buildInstagramDeps(integration.externalId, integration.secretRef ?? "");

  return deps.channelAdapter.sendOutbound({ externalConversationId, externalUserId, text });
}
