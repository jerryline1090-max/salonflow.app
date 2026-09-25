import { ChannelAdapter, UnifiedInboundMessage, UnifiedOutboundMessage, SendResult } from "./types";
import { MediaStore } from "../mediaStore";
import { WhatsAppApiClient } from "./whatsappApiClient";

/**
 * Section 1A + 3: WhatsApp text/voice/image/video all funnel through here.
 * This is the ONLY file in the codebase that knows the shape of a WhatsApp
 * Cloud API webhook payload — everything downstream sees UnifiedInboundMessage.
 */
export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly channel = "WHATSAPP" as const;

  constructor(
    private mediaStore: MediaStore,
    private apiClient: WhatsAppApiClient
  ) {}

  async normalizeInbound(rawPayload: any, businessId: string): Promise<UnifiedInboundMessage[]> {
    const results: UnifiedInboundMessage[] = [];

    for (const entry of rawPayload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        for (const msg of value?.messages ?? []) {
          const base = {
            channel: "WHATSAPP" as const,
            businessId,
            externalConversationId: `${phoneNumberId}:${msg.from}`,
            externalUserId: msg.from,
            externalMessageId: msg.id,
            receivedAt: new Date(Number(msg.timestamp) * 1000),
          };

          if (msg.type === "text") {
            results.push({ ...base, type: "TEXT", text: msg.text?.body });
            continue;
          }

          if (msg.type === "audio" || msg.type === "image" || msg.type === "video") {
            const mediaId = msg[msg.type].id;
            const caption = msg[msg.type].caption;
            try {
              const { url, mimeType, authHeader } = await this.apiClient.fetchMediaUrl(mediaId);
              const stored = await this.mediaStore.downloadAndStore(url, { mimeType, authHeader });
              results.push({
                ...base,
                type: msg.type === "audio" ? "VOICE" : msg.type === "image" ? "IMAGE" : "VIDEO",
                text: caption,
                mediaSecureRef: stored.secureRef,
                mediaMimeType: stored.mimeType,
              });
            } catch {
              // Media couldn't be downloaded — still record that a message
              // arrived (section 20: never silently drop it) as OTHER, with
              // no media reference. The orchestrator/UI can surface this as
              // "a media message failed to process".
              results.push({ ...base, type: "OTHER", text: caption ?? "[media could not be downloaded]" });
            }
            continue;
          }

          // Stickers, contacts, locations, reactions, etc. — logged as OTHER
          // rather than dropped, so nothing a client sends vanishes silently.
          results.push({ ...base, type: "OTHER", text: undefined });
        }
        // value.statuses (delivery/read receipts) are intentionally ignored here —
        // not client messages, nothing for the conversation engine to do with them.
      }
    }

    return results;
  }

  async sendOutbound(message: UnifiedOutboundMessage): Promise<SendResult> {
    try {
      await this.apiClient.sendText(message.externalUserId, message.text);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
