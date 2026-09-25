import { SecretsProvider } from "../secretsProvider";

/**
 * Section 19 (master spec): integration setup happens through Meta's
 * official onboarding — SalonFlow never collects a WhatsApp/Facebook
 * password. By the time this client runs, `accessTokenRef` already points
 * to a long-lived system-user token obtained via that flow and stored via
 * SecretsProvider — this file just makes the two Graph API calls the
 * adapter needs.
 *
 * NOTE: this talks to a real external API (graph.facebook.com). It hasn't
 * been exercised against the live API in this environment (no network
 * access here) — the shapes match Meta's documented Cloud API as of this
 * writing, but verify against a real WABA before relying on it in
 * production.
 */
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

export class WhatsAppApiClient {
  constructor(
    private phoneNumberId: string,
    private accessTokenRef: string,
    private secrets: SecretsProvider
  ) {}

  private async getToken(): Promise<string> {
    return this.secrets.getSecret(this.accessTokenRef);
  }

  /** Resolves a media ID from an inbound webhook payload to a short-lived, authenticated download URL. */
  async fetchMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string; authHeader: string }> {
    const token = await this.getToken();
    const res = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`WhatsApp media lookup failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { url?: unknown; mime_type?: unknown };
    if (typeof data.url !== "string" || typeof data.mime_type !== "string") {
      throw new Error("WhatsApp media lookup returned an invalid response");
    }
    return { url: data.url, mimeType: data.mime_type, authHeader: `Bearer ${token}` };
  }

  async sendText(toWaId: string, text: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${GRAPH_API_BASE}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toWaId,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${res.statusText}`);
  }
}
