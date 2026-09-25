import { SecretsProvider } from "../secretsProvider";

/**
 * Instagram messaging runs through the same Graph API family as WhatsApp,
 * scoped to the connected Instagram professional account's page access
 * token. As with whatsappApiClient.ts: shapes match Meta's documented API,
 * not exercised against a live account in this environment.
 */
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

export class InstagramApiClient {
  constructor(
    private igAccountId: string,
    private accessTokenRef: string,
    private secrets: SecretsProvider
  ) {}

  private async getToken(): Promise<string> {
    return this.secrets.getSecret(this.accessTokenRef);
  }

  async sendText(recipientId: string, text: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${GRAPH_API_BASE}/${this.igAccountId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });
    if (!res.ok) throw new Error(`Instagram send failed: ${res.status} ${res.statusText}`);
  }
}
