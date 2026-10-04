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
    /** Safe diagnostic metadata; never contains provider credentials or payloads. */
    public readonly providerStatus?: number,
    /** Allowlisted top-level provider message, normalized and length-limited. */
    public readonly providerMessage?: string,
    /** Only the provider's boolean top-level status, never arbitrary data. */
    public readonly providerResponseStatus?: boolean,
    public readonly rejectionCategory?: "STATE_CONFLICT" | "CREDENTIAL_INVALID",
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
  /** Server plan configuration in kobo; required by Paystack initialization. */
  amount: number;
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
  /** Provider-only credential used for subscription enable/disable. Never client-visible. */
  providerEmailToken?: string;
  providerPlanCode?: string;
  currentPeriodEndsAt?: Date;
}

export interface ProviderSubscriptionState {
  providerSubscriptionId: string;
  providerCustomerId?: string;
  providerEmailToken?: string;
  providerPlanCode?: string;
  currentPeriodEndsAt?: Date;
  status?: "ACTIVE" | "NON_RENEWING" | "CANCELLED" | "PAST_DUE";
}

export interface InitialPaymentEvidence {
  reference: string;
  amount: number;
  currency: string;
  providerCustomerId: string;
  providerPlanCode: string;
}

/** Server-only verified provider evidence. Never a client DTO. */
export interface VerifiedInitialPayment extends InitialPaymentEvidence {
  transactionId: string;
  paidAt: Date;
  domain: "test" | "live";
  integrationId?: string;
  /** Optional transaction plan ID; missing plan data is valid. */
  providerPlanId?: string;
}

export interface DiscoveredSubscription {
  providerSubscriptionId: string;
  providerEmailToken: string;
  providerCustomerId: string;
  providerPlanCode: string;
  createdAt: Date;
  currentPeriodEndsAt: Date;
  status: "ACTIVE" | "NON_RENEWING";
}

export type SubscriptionDiscovery =
  | { outcome: "exactly_one"; candidate: DiscoveredSubscription }
  | { outcome: "not_found" | "ambiguous" };

/**
 * Provider boundary. Checkout, signature verification, webhook normalization,
 * and future subscription operations stay outside core subscription services.
 */
export interface BillingProviderAdapter {
  initializeCheckout(input: InitializeCheckoutInput): Promise<InitializeCheckoutResult>;
  verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean;
  normalizeWebhookEvent(payload: unknown): NormalizedBillingEvent | null;
  getSubscriptionState?(providerSubscriptionId: string): Promise<ProviderSubscriptionState | null>;
  verifyInitialPayment?(input: InitialPaymentEvidence): Promise<VerifiedInitialPayment>;
  discoverSubscriptions?(payment: VerifiedInitialPayment): Promise<SubscriptionDiscovery>;
  disableSubscription?(input: { providerSubscriptionId: string; providerEmailToken: string }): Promise<void>;
  enableSubscription?(input: { providerSubscriptionId: string; providerEmailToken: string }): Promise<void>;
  getPlanCode?(planCode: PlanCode): string;
}
