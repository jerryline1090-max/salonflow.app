import { createHmac, timingSafeEqual } from "crypto";
import {
  BillingProviderAdapter,
  BillingProviderError,
  InitializeCheckoutInput,
  InitializeCheckoutResult,
  NormalizedBillingEvent,
} from "../billingProvider";
import { PaystackConfig } from "./paystackConfig";

interface PaystackHttpResponse {
  status: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
}

export interface PaystackHttpClient {
  post(
    path: string,
    body: Record<string, string>,
    options: { authorization: string; timeoutMs: number },
  ): Promise<PaystackHttpResponse>;
}

/**
 * This adapter can be unit-tested through PaystackHttpClient. The concrete
 * network client is deliberately deferred until checkout route wiring, so this
 * foundation never creates a provider request merely by being configured.
 */
export class PaystackAdapter implements BillingProviderAdapter {
  constructor(
    private readonly config: PaystackConfig,
    private readonly http: PaystackHttpClient,
  ) {}

  getPlanCode(planCode: InitializeCheckoutInput["planCode"]): string {
    return this.config.planCodes[planCode];
  }

  async initializeCheckout(input: InitializeCheckoutInput): Promise<InitializeCheckoutResult> {
    try {
      const response = await this.http.post(
        "/transaction/initialize",
        {
          email: input.email,
          // The mapping is server configuration, never a browser-supplied value.
          plan: this.getPlanCode(input.planCode),
          reference: input.reference,
          ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        },
        { authorization: `Bearer ${this.config.secretKey}`, timeoutMs: this.config.timeoutMs },
      );

      const data = response.data;
      if (!response.status || !data?.authorization_url || !data.access_code || !data.reference) {
        throw new BillingProviderError("MALFORMED_RESPONSE", "Paystack returned an invalid checkout response");
      }

      return {
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
        providerReference: data.reference,
      };
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BillingProviderError("TIMEOUT", "Paystack request timed out");
      }
      throw new BillingProviderError("UNAVAILABLE", "Paystack billing provider is unavailable");
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.config.secretKey).update(rawBody).digest("hex");
    const actual = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  }

  normalizeWebhookEvent(payload: unknown): NormalizedBillingEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const event = payload as { event?: unknown; data?: { id?: unknown; reference?: unknown; paid_at?: unknown } };
    if (typeof event.event !== "string" || !event.event) return null;
    const providerEventId = typeof event.data?.id === "string" || typeof event.data?.id === "number"
      ? String(event.data.id)
      : typeof event.data?.reference === "string"
        ? event.data.reference
        : null;
    if (!providerEventId) return null;

    const paidAt = typeof event.data?.paid_at === "string" ? new Date(event.data.paid_at) : undefined;
    return {
      provider: "PAYSTACK",
      providerEventId,
      eventType: event.event,
      providerReference: typeof event.data?.reference === "string" ? event.data.reference : undefined,
      occurredAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined,
    };
  }
}
