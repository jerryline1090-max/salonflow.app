import { PlanCode } from "@prisma/client";

export type BillingProviderName = "PAYSTACK";

export type BillingProviderErrorKind =
  | "CONFIGURATION"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "REJECTED"
  | "MALFORMED_RESPONSE";

/** Safe, provider-independent error classification for routes and jobs. */
export class BillingProviderError extends Error {
  constructor(
    public readonly kind: BillingProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BillingProviderError";
  }
}

export interface InitializeCheckoutInput {
  /** Generated server-side; never accepted as a browser-controlled amount. */
  reference: string;
  email: string;
  planCode: PlanCode;
  metadata: { checkoutId: string; checkoutReference: string; businessId: string; subscriptionId: string; planCode: PlanCode };
  callbackUrl?: string;
}

export interface InitializeCheckoutResult {
  authorizationUrl: string;
  accessCode: string;
  providerReference: string;
}

export interface NormalizedBillingEvent {
  provider: BillingProviderName;
  providerEventId: string;
  eventType: string;
  providerReference?: string;
  occurredAt?: Date;
  amount?: number;
  currency?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  providerPlanCode?: string;
  currentPeriodEndsAt?: Date;
}

export interface ProviderSubscriptionState {
  providerSubscriptionId: string;
  providerCustomerId?: string;
  providerPlanCode?: string;
  currentPeriodEndsAt?: Date;
  status?: "ACTIVE" | "CANCELLED" | "PAST_DUE";
}

/**
 * Provider boundary. Checkout, signature verification, webhook normalization,
 * and future subscription operations stay outside core subscription services.
 */
export interface BillingProviderAdapter {
  initializeCheckout(input: InitializeCheckoutInput): Promise<InitializeCheckoutResult>;
  verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean;
  normalizeWebhookEvent(payload: unknown): NormalizedBillingEvent | null;
  getSubscriptionState?(providerSubscriptionId: string): Promise<ProviderSubscriptionState | null>;
  cancelSubscription?(providerSubscriptionId: string): Promise<void>;
  getPlanCode?(planCode: PlanCode): string;
}
