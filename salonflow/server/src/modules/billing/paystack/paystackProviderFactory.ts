import { BillingProviderError } from "../billingProvider";
import { PaystackAdapter, PaystackHttpClient } from "./paystackAdapter";
import { getPaystackConfig } from "./paystackConfig";
import { parsePaystackJson, PAYSTACK_JSON_LIMIT_BYTES } from "./paystackJson";
import { TextDecoder } from "util";

const MAX_PROVIDER_MESSAGE_LENGTH = 240;

async function readTransactionText(response: Response): Promise<string> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PAYSTACK_JSON_LIMIT_BYTES) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally { reader.releaseLock(); }
}

async function readSafeProviderError(response: { json(): Promise<unknown> }, protectedValues: string[]) {
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    const { status, message: raw } = payload as { status?: unknown; message?: unknown };
    const providerResponseStatus = typeof status === "boolean" ? status : undefined;
    if (typeof raw !== "string") return { providerResponseStatus };
    const message = raw.trim().replace(/\s+/g, " ");
    // Do not retain reflected server credentials, PII, URLs, structured data,
    // long numeric/card values or opaque identifiers, even past the length cap.
    const unsafe = protectedValues.some(value => value && message.toLowerCase().includes(value.toLowerCase()))
      || !/^[A-Za-z][A-Za-z0-9 .,:;!?'()/-]*$/.test(message)
      || /@|https?:|bearer\s|(?:sk|pk)[_-]|AUTH_|\d{6,}|\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{12,}\b/i.test(message);
    if (unsafe) return { providerResponseStatus };
    return { providerResponseStatus, providerMessage: message.slice(0, MAX_PROVIDER_MESSAGE_LENGTH) };
  } catch {
    return {};
  }
}

// Deliberately narrow: unknown rejections remain gateway failures, not claims
// that the OWNER supplied invalid input or that a provider state is understood.
function rejectionCategory(message?: string): "STATE_CONFLICT" | "CREDENTIAL_INVALID" | undefined {
  if (/^Subscription (?:has been cancelled, and cannot be reactivated|is already (?:active|enabled)|cannot be enabled in its current state)\.?$/i.test(message ?? "")) return "STATE_CONFLICT";
  if (/^(?:Invalid (?:subscription code|email token)|Subscription code or email token is invalid)\.?$/i.test(message ?? "")) return "CREDENTIAL_INVALID";
  return undefined;
}

export class FetchPaystackHttpClient implements PaystackHttpClient {
  async get(path: string, options: { authorization: string; timeoutMs: number }) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`https://api.paystack.co${path}`, { headers: { Authorization: options.authorization }, signal: controller.signal });
      if (!response.ok) throw new BillingProviderError("REJECTED", "Paystack rejected the subscription lookup", response.status);
      if (path.startsWith("/transaction/verify/")) {
        try {
          const payload = parsePaystackJson(await readTransactionText(response), "verification");
          if (typeof payload.status !== "boolean") throw new Error();
          return { status: payload.status, data: payload.data };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          throw new BillingProviderError("MALFORMED_RESPONSE", "Paystack returned invalid transaction evidence", response.status);
        }
      }
      return await response.json() as { status: boolean; data?: unknown; meta?: unknown };
    } finally { clearTimeout(timeout); }
  }
  async post(path: string, body: Record<string, string>, options: { authorization: string; timeoutMs: number }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`https://api.paystack.co${path}`, { method: "POST", headers: { Authorization: options.authorization, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const diagnostic = await readSafeProviderError(response, [options.authorization, options.authorization.replace(/^Bearer\s+/i, ""), body.token, body.email, body.code].filter(Boolean));
        throw new BillingProviderError(response.status >= 500 || response.status === 429 ? "UNAVAILABLE" : "REJECTED",
          "Paystack could not complete the billing operation", response.status, diagnostic.providerMessage, diagnostic.providerResponseStatus,
          path === "/subscription/enable" && response.status === 400 ? rejectionCategory(diagnostic.providerMessage) : undefined);
      }
      try {
        return await response.json() as { status: boolean; data?: { authorization_url?: string; access_code?: string; reference?: string } };
      } catch {
        throw new BillingProviderError("MALFORMED_RESPONSE", "Paystack returned an invalid billing response", response.status);
      }
    } finally { clearTimeout(timeout); }
  }
}

export function createPaystackProvider() {
  return new PaystackAdapter(getPaystackConfig(), new FetchPaystackHttpClient());
}
