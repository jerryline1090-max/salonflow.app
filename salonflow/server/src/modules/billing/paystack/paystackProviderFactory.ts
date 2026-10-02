import { BillingProviderError } from "../billingProvider";
import { PaystackAdapter, PaystackHttpClient } from "./paystackAdapter";
import { getPaystackConfig } from "./paystackConfig";

const MAX_PROVIDER_MESSAGE_LENGTH = 240;

async function readSafeProviderMessage(response: { json(): Promise<unknown> }): Promise<string | undefined> {
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || typeof (payload as { message?: unknown }).message !== "string") return undefined;
    const message = (payload as { message: string }).message.trim().replace(/\s+/g, " ");
    return message ? message.slice(0, MAX_PROVIDER_MESSAGE_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

export class FetchPaystackHttpClient implements PaystackHttpClient {
  async get(path: string, options: { authorization: string; timeoutMs: number }) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try { const response = await fetch(`https://api.paystack.co${path}`, { headers: { Authorization: options.authorization }, signal: controller.signal }); if (!response.ok) throw new BillingProviderError("REJECTED", "Paystack rejected the subscription lookup", response.status, await readSafeProviderMessage(response)); return await response.json() as { status: boolean; data?: Record<string, unknown> }; } finally { clearTimeout(timeout); }
  }
  async post(path: string, body: Record<string, string>, options: { authorization: string; timeoutMs: number }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`https://api.paystack.co${path}`, { method: "POST", headers: { Authorization: options.authorization, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new BillingProviderError("REJECTED", "Paystack rejected the checkout request", response.status, await readSafeProviderMessage(response));
      return await response.json() as { status: boolean; data?: { authorization_url?: string; access_code?: string; reference?: string } };
    } finally { clearTimeout(timeout); }
  }
}

export function createPaystackProvider() {
  return new PaystackAdapter(getPaystackConfig(), new FetchPaystackHttpClient());
}
