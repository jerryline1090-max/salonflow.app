/**
 * Section 1 + 21 of the multi-channel spec: WhatsApp, Instagram, and the
 * website widget must all normalize into this ONE shape before anything
 * downstream (the conversation engine, the AI orchestrator, the booking
 * tools) ever sees a message. Nothing downstream of this file knows or
 * cares which provider a message came from beyond the `channel` tag —
 * that's what makes adding Facebook Messenger or SMS later a matter of
 * writing one more file here, not touching the AI or booking logic.
 */

export type Channel = "WHATSAPP" | "INSTAGRAM" | "WEBSITE";
export type UnifiedMessageType = "TEXT" | "VOICE" | "IMAGE" | "VIDEO" | "OTHER";

export interface UnifiedInboundMessage {
  channel: Channel;
  businessId: string;
  // Provider-specific thread/user identifiers. Never surfaced to the client
  // in a reply, never used as a lookup key outside this module + the
  // conversation engine.
  externalConversationId: string;
  externalUserId: string;
  externalMessageId: string;
  type: UnifiedMessageType;
  /** Present for TEXT messages, and optionally as a caption on IMAGE/VIDEO. */
  text?: string;
  /** Set once media has been downloaded and stored — see mediaStore.ts. Never a raw provider URL. */
  mediaSecureRef?: string;
  mediaMimeType?: string;
  receivedAt: Date;
}

export interface UnifiedOutboundMessage {
  externalConversationId: string;
  externalUserId: string;
  text: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

export interface ChannelAdapter {
  readonly channel: Channel;

  /**
   * Turn a provider-specific webhook payload into zero or more unified
   * messages. Returns an empty array for payloads that carry nothing
   * actionable (delivery/read receipts, status callbacks, etc.) — those
   * are acknowledged at the webhook route but never enter the conversation
   * engine as if a client had said something.
   *
   * Async because normalizing a voice/image/video message includes
   * downloading the media from the provider and handing it to mediaStore
   * (section 3 steps 1–2) before the unified message is considered "ready".
   */
  normalizeInbound(rawPayload: unknown, businessId: string): Promise<UnifiedInboundMessage[]>;

  /**
   * Send a reply back through the provider. Must never throw — channel
   * failures are reported in the return value so the caller can record
   * them and decide whether to retry/notify the salon (section 20), rather
   * than crashing the webhook handler or silently pretending it worked.
   */
  sendOutbound(message: UnifiedOutboundMessage): Promise<SendResult>;
}
