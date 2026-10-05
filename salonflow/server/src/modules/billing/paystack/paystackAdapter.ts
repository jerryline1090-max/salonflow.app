import { createHmac, timingSafeEqual } from "crypto";
import {
  BillingProviderAdapter,
  BillingProviderError,
  InitializeCheckoutInput,
  InitializeCheckoutResult,
  NormalizedBillingEvent,
  InitialPaymentEvidence,
  VerifiedInitialPayment,
} from "../billingProvider";
import { PaystackConfig } from "./paystackConfig";
import { paystackResourceId, paystackTransactionId } from "./paystackIdentity";
import { PaystackRead, verifyInitialPaystackPayment, discoverPaystackSubscriptions } from "./paystackDiscovery";

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
  get?: (path: string, options: { authorization: string; timeoutMs: number }) => ReturnType<PaystackRead>;
}

function extractPaystackEmailToken(data: Record<string, unknown>): string | undefined {
  const direct = data.email_token;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const subscription = typeof data.subscription === "object" && data.subscription !== null
    ? data.subscription as Record<string, unknown>
    : undefined;
  const nested = subscription?.email_token;
  return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
}

/**
 * Paystack exposes a stable string customer_code alongside a sometimes numeric
 * customer id. Keep this provider-specific normalization in one place and
 * never infer identity from customer email or arbitrary payload fields.
 */
function extractPaystackCustomerIdentity(data: Record<string, unknown>): string | undefined {
  const customer = typeof data.customer === "object" && data.customer !== null
    ? data.customer as Record<string, unknown>
    : undefined;
  const customerCode = customer?.customer_code;
  if (typeof customerCode === "string" && customerCode.trim()) return customerCode.trim();
  const customerId = customer?.id;
  if (typeof customerId === "string" && customerId.trim()) return customerId.trim();
  if (typeof customerId === "number" && Number.isFinite(customerId)) return String(customerId);
  return undefined;
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

  private discoveryRead: PaystackRead = async (path) => {
    try {
      if (!this.http.get) throw new Error();
      return await this.http.get(path, { authorization: `Bearer ${this.config.secretKey}`, timeoutMs: this.config.timeoutMs });
    } catch (error) {
      // Never propagate provider message text, bodies, tokens, or arbitrary errors.
      if (error instanceof BillingProviderError && error.kind === "MALFORMED_RESPONSE") {
        throw new BillingProviderError("MALFORMED_RESPONSE", "Provider discovery evidence is malformed");
      }
      if (error instanceof Error && error.name === "AbortError") throw new BillingProviderError("TIMEOUT", "Provider discovery timed out");
      throw new BillingProviderError("UNAVAILABLE", "Provider discovery is unavailable");
    }
  };

  verifyInitialPayment(input: InitialPaymentEvidence) {
    return verifyInitialPaystackPayment(this.discoveryRead, this.config, input);
  }

  discoverSubscriptions(payment: VerifiedInitialPayment) {
    return discoverPaystackSubscriptions(this.discoveryRead, payment);
  }

  async getSubscriptionState(providerSubscriptionId: string) {
    if (!this.http.get) throw new BillingProviderError("UNAVAILABLE", "Paystack subscription lookup is unavailable");
    try {
      const response = await this.http.get(`/subscription/${encodeURIComponent(providerSubscriptionId)}`, { authorization: `Bearer ${this.config.secretKey}`, timeoutMs: this.config.timeoutMs });
      const data = response.data as Record<string, unknown> | undefined;
      if (response.status !== true || !data || typeof data.subscription_code !== "string" || data.subscription_code !== providerSubscriptionId) throw new BillingProviderError("MALFORMED_RESPONSE", "Paystack returned an invalid subscription response");
      const next = typeof data.next_payment_date === "string" ? new Date(data.next_payment_date) : undefined;
      return {
        providerSubscriptionId: data.subscription_code,
        providerCustomerId: extractPaystackCustomerIdentity(data),
        providerEmailToken: extractPaystackEmailToken(data),
        providerPlanCode: typeof data.plan === "object" && data.plan !== null && typeof (data.plan as Record<string, unknown>).plan_code === "string" ? (data.plan as Record<string, string>).plan_code : undefined,
        status: data.status === "active" ? "ACTIVE" as const : data.status === "non-renewing" ? "NON_RENEWING" as const : data.status === "cancelled" ? "CANCELLED" as const : data.status === "past_due" ? "PAST_DUE" as const : undefined,
        currentPeriodEndsAt: next && !Number.isNaN(next.getTime()) ? next : undefined,
      };
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new BillingProviderError("TIMEOUT", "Paystack subscription lookup timed out");
      throw new BillingProviderError("UNAVAILABLE", "Paystack subscription lookup is unavailable");
    }
  }

  async disableSubscription(input: { providerSubscriptionId: string; providerEmailToken: string }) {
    return this.changeSubscriptionRenewal("/subscription/disable", input, "disable");
  }

  async enableSubscription(input: { providerSubscriptionId: string; providerEmailToken: string }) {
    return this.changeSubscriptionRenewal("/subscription/enable", input, "enable");
  }

  private async changeSubscriptionRenewal(path: string, input: { providerSubscriptionId: string; providerEmailToken: string }, action: "disable" | "enable") {
    try {
      const response = await this.http.post(path, { code: input.providerSubscriptionId, token: input.providerEmailToken }, { authorization: `Bearer ${this.config.secretKey}`, timeoutMs: this.config.timeoutMs });
      if (response?.status !== true) throw new BillingProviderError("MALFORMED_RESPONSE", `Paystack returned an invalid subscription ${action} response`);
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new BillingProviderError("TIMEOUT", `Paystack subscription ${action} timed out`);
      throw new BillingProviderError("UNAVAILABLE", `Paystack subscription ${action} is unavailable`);
    }
  }

  async initializeCheckout(input: InitializeCheckoutInput): Promise<InitializeCheckoutResult> {
    try {
      const response = await this.http.post(
        "/transaction/initialize",
        {
          email: input.email,
          // Paystack requires this transaction amount even when the configured
          // recurring plan remains authoritative for the eventual debit.
          amount: String(input.amount),
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
    if (!["charge.success", "invoice.payment_failed", "subscription.create", "subscription.not_renew", "subscription.disable"].includes(String(event.event))) return null;
    // Both supported Paystack event types must contain their own stable object
    // identity. Do not fall back to arbitrary payload fields.
    const rawId = ["subscription.create", "subscription.not_renew", "subscription.disable"].includes(String(event.event)) ? event.data?.subscription_code : event.data?.id;
    const providerObjectId = String(event.event).startsWith("subscription.")
      ? (typeof rawId === "string" && rawId.trim() ? rawId : undefined)
      : event.event === "charge.success" ? paystackTransactionId(rawId) : paystackResourceId(rawId);
    const providerEventId = providerObjectId ? `${event.event}:${providerObjectId}` : null;
    if (!providerEventId) return null;

    const paidAt = typeof event.data?.paid_at === "string" ? new Date(event.data.paid_at) : undefined;
    const periodEnd = typeof event.data?.next_payment_date === "string" ? new Date(event.data.next_payment_date) : undefined;
    const amount = typeof event.data?.amount === "number" ? event.data.amount : undefined;
    const currency = typeof event.data?.currency === "string" ? event.data.currency.toUpperCase() : undefined;
    return {
      provider: "PAYSTACK",
      providerEventId,
      eventType: String(event.event),
      providerReference: typeof event.data?.reference === "string" ? event.data.reference
        : typeof event.data?.transaction === "object" && event.data.transaction !== null && typeof (event.data.transaction as Record<string, unknown>).reference === "string" ? (event.data.transaction as Record<string, string>).reference
          : typeof event.data?.metadata === "object" && event.data.metadata !== null && typeof (event.data.metadata as Record<string, unknown>).checkoutReference === "string" ? (event.data.metadata as Record<string, string>).checkoutReference : undefined,
      occurredAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined,
      amount,
      currency,
      providerCustomerId: extractPaystackCustomerIdentity(event.data ?? {}),
      providerEmailToken: extractPaystackEmailToken(event.data ?? {}),
      providerSubscriptionId: typeof event.data?.subscription_code === "string" ? event.data.subscription_code : typeof event.data?.subscription === "object" && event.data.subscription !== null && typeof (event.data.subscription as Record<string, unknown>).subscription_code === "string" ? (event.data.subscription as Record<string, string>).subscription_code : undefined,
      providerPlanCode: typeof event.data?.plan === "object" && event.data.plan !== null && typeof (event.data.plan as Record<string, unknown>).plan_code === "string" ? (event.data.plan as Record<string, string>).plan_code : undefined,
      currentPeriodEndsAt: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : undefined,
    };
  }
}
