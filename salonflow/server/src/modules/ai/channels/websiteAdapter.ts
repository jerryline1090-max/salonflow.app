import { ChannelAdapter, UnifiedInboundMessage, UnifiedOutboundMessage, SendResult } from "./types";

/**
 * Section 1C: website chat starts text-only, over ordinary request/response
 * rather than a provider webhook — the widget POSTs a message and the same
 * HTTP response carries the AI's reply (see routes/publicChat.routes.ts).
 * `sendOutbound` here is a no-op that always "succeeds": there's no separate
 * push step to fail, so channel-failure handling (section 20) doesn't apply
 * the same way it does for WhatsApp/Instagram.
 *
 * Kept as a real ChannelAdapter (not a special case) so the exact same
 * orchestrator / conversation engine code path handles it — and so adding
 * a future push-based mode (e.g. widget over WebSocket) later is a matter
 * of changing this one adapter's sendOutbound, per section 22.
 */
export class WebsiteChannelAdapter implements ChannelAdapter {
  readonly channel = "WEBSITE" as const;

  // The website widget doesn't send provider webhooks — routes/publicChat.routes.ts
  // builds the UnifiedInboundMessage directly from the widget's request body,
  // so normalizeInbound here exists only to satisfy the interface.
  async normalizeInbound(rawPayload: unknown): Promise<UnifiedInboundMessage[]> {
    return Array.isArray(rawPayload) ? (rawPayload as UnifiedInboundMessage[]) : [rawPayload as UnifiedInboundMessage];
  }

  async sendOutbound(_message: UnifiedOutboundMessage): Promise<SendResult> {
    return { success: true };
  }
}
