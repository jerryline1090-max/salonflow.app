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
          metadata: JSON.stringify(input.metadata),
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
    const event = payload as { event?: unknown; data?: Record<string, unknown> };
    if (event.event !== "charge.success" && event.event !== "invoice.payment_failed" && event.event !== "subscription.create") return null;
    // Both supported Paystack event types must contain their own stable object
    // identity. Do not fall back to arbitrary payload fields.
    const rawId = event.event === "subscription.create" ? event.data?.subscription_code : event.data?.id;
    const providerObjectId = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : null;
    const providerEventId = providerObjectId ? `${event.event}:${providerObjectId}` : null;
    if (!providerEventId) return null;

    const paidAt = typeof event.data?.paid_at === "string" ? new Date(event.data.paid_at) : undefined;
    const periodEnd = typeof event.data?.next_payment_date === "string" ? new Date(event.data.next_payment_date) : undefined;
    const amount = typeof event.data?.amount === "number" ? event.data.amount : undefined;
    const currency = typeof event.data?.currency === "string" ? event.data.currency.toUpperCase() : undefined;
    return {
      provider: "PAYSTACK",
      providerEventId,
      eventType: event.event,
      providerReference: typeof event.data?.reference === "string" ? event.data.reference : typeof event.data?.metadata === "object" && event.data.metadata !== null && typeof (event.data.metadata as Record<string, unknown>).checkoutReference === "string" ? (event.data.metadata as Record<string, string>).checkoutReference : undefined,
      occurredAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined,
      amount,
      currency,
      providerCustomerId: typeof event.data?.customer === "object" && event.data.customer !== null && typeof (event.data.customer as Record<string, unknown>).id === "string" ? (event.data.customer as Record<string, string>).id : typeof event.data?.customer_code === "string" ? event.data.customer_code : undefined,
      providerSubscriptionId: typeof event.data?.subscription_code === "string" ? event.data.subscription_code : typeof event.data?.subscription === "object" && event.data.subscription !== null && typeof (event.data.subscription as Record<string, unknown>).subscription_code === "string" ? (event.data.subscription as Record<string, string>).subscription_code : undefined,
      providerPlanCode: typeof event.data?.plan === "object" && event.data.plan !== null && typeof (event.data.plan as Record<string, unknown>).plan_code === "string" ? (event.data.plan as Record<string, string>).plan_code : undefined,
      currentPeriodEndsAt: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : undefined,
    };
  }
}
