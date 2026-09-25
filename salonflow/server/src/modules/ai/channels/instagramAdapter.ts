import { ChannelAdapter, UnifiedInboundMessage, UnifiedOutboundMessage, SendResult } from "./types";
import { MediaStore } from "../mediaStore";
import { InstagramApiClient } from "./instagramApiClient";

function mapAttachmentType(igType: string): "IMAGE" | "VIDEO" | "VOICE" | "OTHER" {
  if (igType === "image") return "IMAGE";
  if (igType === "video") return "VIDEO";
  if (igType === "audio") return "VOICE"; // where supported by the current IG API, per section 1B
  return "OTHER";
}

export class InstagramChannelAdapter implements ChannelAdapter {
  readonly channel = "INSTAGRAM" as const;

  constructor(
    private mediaStore: MediaStore,
    private apiClient: InstagramApiClient
  ) {}

  async normalizeInbound(rawPayload: any, businessId: string): Promise<UnifiedInboundMessage[]> {
    const results: UnifiedInboundMessage[] = [];

    for (const entry of rawPayload?.entry ?? []) {
      for (const event of entry?.messaging ?? []) {
        // Echoes of the business's own outbound messages, and read receipts,
        // come through this same webhook — never treat those as inbound
        // client messages.
        if (event.message?.is_echo || event.read || event.delivery) continue;

        const base = {
          channel: "INSTAGRAM" as const,
          businessId,
          externalConversationId: `${entry.id}:${event.sender?.id}`,
          externalUserId: event.sender?.id,
          externalMessageId: event.message?.mid ?? `${event.timestamp}`,
          receivedAt: new Date(event.timestamp ?? Date.now()),
        };

        const text = event.message?.text as string | undefined;
        const attachments = event.message?.attachments as { type: string; payload?: { url?: string } }[] | undefined;

        if (!attachments || attachments.length === 0) {
          results.push({ ...base, type: "TEXT", text });
          continue;
        }

        for (const attachment of attachments) {
          const type = mapAttachmentType(attachment.type);
          if (type === "OTHER" || !attachment.payload?.url) {
            results.push({ ...base, type: "OTHER", text });
            continue;
          }
          try {
            // Instagram attachment URLs are pre-authenticated CDN links —
            // no separate token exchange step like WhatsApp's media endpoint.
            const stored = await this.mediaStore.downloadAndStore(attachment.payload.url, {
              mimeType: type === "IMAGE" ? "image/jpeg" : type === "VIDEO" ? "video/mp4" : "audio/mp4",
            });
            results.push({ ...base, type, text, mediaSecureRef: stored.secureRef, mediaMimeType: stored.mimeType });
          } catch {
            results.push({ ...base, type: "OTHER", text: text ?? "[media could not be downloaded]" });
          }
        }
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
