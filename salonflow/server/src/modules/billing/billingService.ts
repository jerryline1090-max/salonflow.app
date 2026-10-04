import { BillingEventStatus, BillingInvoiceStatus, BillingProvider, PlanCode, Prisma, SubscriptionStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { getPlanDefinition } from "../subscriptions/planConfig";
import { BillingProviderAdapter, BillingProviderError, NormalizedBillingEvent } from "./billingProvider";
import { getCancellationFinalization, isCancellationEffective } from "../subscriptions/subscriptionService";
import { rewardReferralForVerifiedPayment } from "../referrals/referralService";
import { discoverMissingSubscription } from "./subscriptionDiscovery";
import { providerNonRenewingState } from "./providerRenewalState";

export class BillingCorrelationError extends Error {}
class ProviderSubscriptionConflictError extends BillingCorrelationError {}

function hasProviderSubscriptionConflict(subscription: { providerSubscriptionId?: string | null }, event: NormalizedBillingEvent) {
  return Boolean(
    subscription.providerSubscriptionId
      && event.providerSubscriptionId
      && subscription.providerSubscriptionId !== event.providerSubscriptionId,
  );
}

export async function initializeBusinessCheckout(input: {
  businessId: string;
  actorUserId: string;
  planCode: PlanCode;
  provider: BillingProviderAdapter;
}) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    include: { subscription: true, users: { where: { id: input.actorUserId, role: "OWNER", isActive: true }, select: { email: true } } },
  });
  if (!business?.subscription || !business.users[0]?.email) throw new BillingCorrelationError("Billing checkout is unavailable");
  // A plan-based Paystack checkout creates a recurring provider subscription.
  // Never start one while another provider subscription is authoritative: that
  // could leave both schedules eligible to debit the same SalonFlow business.
  if (business.subscription.providerSubscriptionId) {
    throw new BillingCorrelationError("Existing recurring billing requires reconciliation before a replacement checkout can be started");
  }

  // Recovery keeps the existing commercial plan. Changing a recurring plan
  // needs an explicit provider-supported migration, not a second checkout.
  const isRecovery = business.subscription.status === SubscriptionStatus.PAST_DUE
    || business.subscription.status === SubscriptionStatus.SUSPENDED
    || business.subscription.status === SubscriptionStatus.CANCELLED;
  if (isRecovery && input.planCode !== business.subscription.planCode) {
    throw new BillingCorrelationError("Recovery checkout must use the current subscription plan");
  }
  const plan = getPlanDefinition(input.planCode);
  const providerPlanCode = input.provider.getPlanCode?.(input.planCode);
  if (!providerPlanCode) throw new BillingProviderError("CONFIGURATION", "Billing provider plan mapping is unavailable");
  const callbackUrl = getPaystackCallbackUrl();

  const reference = `sf_${randomUUID().replace(/-/g, "")}`;
  const checkout = await prisma.billingCheckout.create({
    data: {
      businessId: business.id,
      subscriptionId: business.subscription.id,
      provider: BillingProvider.PAYSTACK,
      reference,
      planCode: input.planCode,
      providerPlanCode,
      amount: plan.monthlyPriceMinor,
      currency: plan.currency,
    },
  });

  try {
    const result = await input.provider.initializeCheckout({
      reference,
      email: business.users[0].email,
      planCode: input.planCode,
      amount: plan.monthlyPriceMinor,
      metadata: { checkoutId: checkout.id, checkoutReference: reference, businessId: business.id, subscriptionId: business.subscription.id, planCode: input.planCode },
      callbackUrl,
    });
    await prisma.auditLog.create({ data: { businessId: business.id, actorUserId: input.actorUserId, actorType: "USER", resource: "billing", resourceId: checkout.id, action: "checkout_initiated", newValue: JSON.stringify({ planCode: input.planCode, reference }) } });
    return { authorizationUrl: result.authorizationUrl, accessCode: result.accessCode, reference: result.providerReference };
  } catch (error) {
    await prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED" } });
    throw error;
  }
}

function getPaystackCallbackUrl() {
  const value = process.env.PAYSTACK_CALLBACK_URL?.trim();
  if (!value) throw new BillingProviderError("CONFIGURATION", "Paystack checkout callback is not configured");
  try {
    const url = new URL(value);
    const localDevelopmentCallback = process.env.NODE_ENV !== "production"
      && url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localDevelopmentCallback) throw new Error("protocol");
    return url.toString();
  } catch {
    throw new BillingProviderError("CONFIGURATION", "Paystack checkout callback is invalid");
  }
}

export async function scheduleCancellation(businessId: string, actorUserId: string, provider: BillingProviderAdapter) {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription || (subscription.status !== SubscriptionStatus.ACTIVE && subscription.status !== SubscriptionStatus.PAST_DUE)) throw new BillingCorrelationError("This subscription cannot be cancelled right now");
  if (subscription.cancelAtPeriodEnd) return subscription;
  if (!subscription.providerSubscriptionId || !subscription.providerEmailToken || !provider.disableSubscription) {
    throw new BillingCorrelationError("Cancellation is unavailable until the provider subscription can be verified");
  }
  // Paystack disable makes the subscription non-renewing; access remains
  // local and active until the known period end or a verified disable event.
  await provider.disableSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, providerEmailToken: subscription.providerEmailToken });
  const updated = await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true } });
  await prisma.auditLog.create({ data: { businessId, actorUserId, actorType: "USER", resource: "billing", resourceId: subscription.id, action: "cancellation_scheduled", newValue: JSON.stringify({ currentPeriodEndsAt: subscription.currentPeriodEndsAt }) } });
  return updated;
}

export async function undoScheduledCancellation(businessId: string, actorUserId: string, provider: BillingProviderAdapter) {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription?.cancelAtPeriodEnd) return subscription;
  if (isCancellationEffective(subscription)) throw new BillingCorrelationError("An effective cancellation requires a verified payment to recover");
  if (!subscription.providerSubscriptionId || !subscription.providerEmailToken || !provider.enableSubscription || !provider.getSubscriptionState) {
    throw new BillingCorrelationError("Cancellation cannot be restored until the provider subscription can be verified");
  }
  const verifyIdentity = (remote: Awaited<ReturnType<NonNullable<BillingProviderAdapter["getSubscriptionState"]>>>) => {
    if (!remote || remote.providerSubscriptionId !== subscription.providerSubscriptionId
      || remote.providerEmailToken !== subscription.providerEmailToken
      || subscription.providerCustomerId && remote.providerCustomerId !== subscription.providerCustomerId
      || subscription.providerPlanCode && remote.providerPlanCode !== subscription.providerPlanCode) {
      throw new BillingProviderError("REJECTED", "Subscription credentials require verified reconciliation", undefined, undefined, undefined, "CREDENTIAL_INVALID");
    }
    return remote;
  };
  // Never refresh a credential as a side effect of undo. A differing token or
  // identity requires explicit verified reconciliation before a provider write.
  const before = verifyIdentity(await provider.getSubscriptionState(subscription.providerSubscriptionId));
  if (before.status !== "NON_RENEWING") throw new BillingProviderError("REJECTED", "Provider subscription state does not permit undo", undefined, undefined, undefined, "STATE_CONFLICT");
  await provider.enableSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, providerEmailToken: subscription.providerEmailToken });
  const confirmed = verifyIdentity(await provider.getSubscriptionState(subscription.providerSubscriptionId));
  if (confirmed.status !== "ACTIVE" || isCancellationEffective(subscription)) {
    throw new BillingProviderError("REJECTED", "Provider has not confirmed renewable billing", undefined, undefined, undefined, "STATE_CONFLICT");
  }
  if (!confirmed.currentPeriodEndsAt || !subscription.currentPeriodEndsAt
    || confirmed.currentPeriodEndsAt.getTime() !== subscription.currentPeriodEndsAt.getTime()) {
    throw new BillingProviderError("MALFORMED_RESPONSE", "Provider period requires verified reconciliation");
  }
  const updated = await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: false } });
  await prisma.auditLog.create({ data: { businessId, actorUserId, actorType: "USER", resource: "billing", resourceId: subscription.id, action: "cancellation_undone" } });
  return updated;
}

export async function getBillingHistory(businessId: string) {
  return prisma.billingInvoice.findMany({ where: { businessId }, select: { id: true, amount: true, currency: true, status: true, paidAt: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 50 });
}

export async function finalizeScheduledCancellation(businessId: string, now = new Date()) {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription || !getCancellationFinalization(subscription, now).shouldFinalize) return subscription;
  const updated = await prisma.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.CANCELLED } });
  await prisma.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: subscription.id, action: "cancellation_effective" } });
  return updated;
}

export async function reconcileKnownSubscription(businessId: string, provider: BillingProviderAdapter) {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (subscription && !subscription.providerSubscriptionId) return discoverMissingSubscription(businessId, provider);
  if (!subscription?.providerSubscriptionId || !provider.getSubscriptionState) return { reconciled: false as const };
  const remote = await provider.getSubscriptionState(subscription.providerSubscriptionId);
  if (!remote || remote.providerSubscriptionId !== subscription.providerSubscriptionId) return { reconciled: false as const };
  const data = {
    providerCustomerId: remote.providerCustomerId ?? subscription.providerCustomerId,
    providerEmailToken: remote.providerEmailToken ?? subscription.providerEmailToken,
    providerPlanCode: remote.providerPlanCode ?? subscription.providerPlanCode,
    currentPeriodEndsAt: remote.currentPeriodEndsAt ?? subscription.currentPeriodEndsAt,
    ...(remote.status === "NON_RENEWING" ? providerNonRenewingState(remote.currentPeriodEndsAt ?? subscription.currentPeriodEndsAt) : {}),
  };
  if (JSON.stringify(data) === JSON.stringify({ providerCustomerId: subscription.providerCustomerId, providerEmailToken: subscription.providerEmailToken, providerPlanCode: subscription.providerPlanCode, currentPeriodEndsAt: subscription.currentPeriodEndsAt, ...(remote.status === "NON_RENEWING" ? { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd } : {}) })) return { reconciled: true as const, changed: false };
  await prisma.subscription.update({ where: { id: subscription.id }, data });
  await prisma.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: subscription.id, action: "reconciliation_changed" } });
  return { reconciled: true as const, changed: true };
}

const BILLING_EVENT_LEASE_MS = 5 * 60_000;

class LostBillingEventClaimError extends Error {}

type BillingEventClaim =
  | { kind: "claimed"; id: string; token: string }
  | { kind: "processed" | "rejected" | "processing" };

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

function failureCodeFor(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return name.includes("PrismaClient") ? "DATABASE_UNAVAILABLE" : "PROCESSING_FAILED";
}

/** Never serialize an exception, its message/stack/cause, or provider bodies.
 * Even error.name and provider metadata must be allowlisted at runtime. */
function safeBillingErrorMetadata(error: unknown) {
  const allowedNames = ["Error", "TypeError", "SyntaxError", "AbortError", "BillingProviderError",
    "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError",
    "PrismaClientValidationError", "PrismaClientRustPanicError"];
  const name = error instanceof Error && allowedNames.includes(error.name) ? error.name : "UnknownError";
  const kind = error instanceof BillingProviderError
    && ["CONFIGURATION", "TIMEOUT", "UNAVAILABLE", "REJECTED", "MALFORMED_RESPONSE"].includes(error.kind) ? error.kind : undefined;
  const providerStatus = error instanceof BillingProviderError && Number.isInteger(error.providerStatus)
    && error.providerStatus! >= 100 && error.providerStatus! <= 599 ? error.providerStatus : undefined;
  return { name, failureCode: failureCodeFor(error), ...(kind ? { kind } : {}), ...(providerStatus ? { providerStatus } : {}) };
}

async function claimBillingEvent(event: NormalizedBillingEvent): Promise<BillingEventClaim> {
  const now = new Date();
  const token = randomUUID();
  try {
    const created = await prisma.billingEvent.create({
      data: { provider: BillingProvider.PAYSTACK, providerEventId: event.providerEventId, eventType: event.eventType, status: BillingEventStatus.PROCESSING, processingStartedAt: now, processingToken: token },
    });
    return { kind: "claimed", id: created.id, token };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const existing = await prisma.billingEvent.findUnique({ where: { provider_providerEventId: { provider: BillingProvider.PAYSTACK, providerEventId: event.providerEventId } } });
  if (!existing) throw new LostBillingEventClaimError();
  if (existing.status === BillingEventStatus.PROCESSED) return { kind: "processed" };
  if (existing.status === BillingEventStatus.REJECTED) return { kind: "rejected" };

  const staleBefore = new Date(now.getTime() - BILLING_EVENT_LEASE_MS);
  const retryableStatuses = existing.status === BillingEventStatus.PROCESSING
    ? undefined
    : { in: [BillingEventStatus.FAILED, BillingEventStatus.RECEIVED] };
  const where = existing.status === BillingEventStatus.PROCESSING
    ? { id: existing.id, status: BillingEventStatus.PROCESSING, processingStartedAt: { lte: staleBefore } }
    : { id: existing.id, status: retryableStatuses };
  const claimed = await prisma.billingEvent.updateMany({
    where,
    data: { status: BillingEventStatus.PROCESSING, processingStartedAt: now, processingToken: token, processedAt: null, failureCode: null, failureStage: null },
  });
  return claimed.count === 1 ? { kind: "claimed", id: existing.id, token } : { kind: "processing" };
}

async function rejectClaim(claim: Extract<BillingEventClaim, { kind: "claimed" }>, data: { businessId?: string; failureCode: string; failureStage: string }) {
  const rejected = await prisma.billingEvent.updateMany({
    where: { id: claim.id, status: BillingEventStatus.PROCESSING, processingToken: claim.token },
    data: { status: BillingEventStatus.REJECTED, businessId: data.businessId, failureCode: data.failureCode, failureStage: data.failureStage, processedAt: new Date(), processingToken: null },
  });
  if (rejected.count !== 1) throw new LostBillingEventClaimError();
}

async function failClaim(claim: Extract<BillingEventClaim, { kind: "claimed" }>, data: { businessId?: string; failureCode: string; failureStage: string }) {
  const failed = await prisma.billingEvent.updateMany({
    where: { id: claim.id, status: BillingEventStatus.PROCESSING, processingToken: claim.token },
    data: { status: BillingEventStatus.FAILED, businessId: data.businessId, failureCode: data.failureCode, failureStage: data.failureStage, processedAt: new Date(), processingToken: null },
  });
  return failed.count === 1;
}

async function persistTerminalOutcome(claim: Extract<BillingEventClaim, { kind: "claimed" }>, data: { businessId?: string; failureCode: string; failureStage: string }, event: NormalizedBillingEvent) {
  try {
    await rejectClaim(claim, data);
    return true;
  } catch (error) {
    const failureCode = failureCodeFor(error);
    console.error("[billing] terminal webhook outcome could not be persisted", { providerEventId: event.providerEventId, eventType: event.eventType, stage: data.failureStage, ...safeBillingErrorMetadata(error) });
    try { await failClaim(claim, { businessId: data.businessId, failureCode, failureStage: data.failureStage }); } catch { /* Returning 503 asks the provider to retry the same event. */ }
    return false;
  }
}

/**
 * Processes a verified provider event under one durable event claim. Five
 * minutes is deliberately longer than the provider's 30-second timeout so a
 * concurrent delivery cannot steal an active transaction, while a crashed
 * worker can eventually be reclaimed by a later delivery.
 */
export async function processVerifiedPaystackEvent(event: NormalizedBillingEvent) {
  if (event.provider !== "PAYSTACK" || !["charge.success", "invoice.payment_failed", "subscription.create", "subscription.not_renew", "subscription.disable"].includes(event.eventType)) {
    return { handled: false, retryable: false, reason: "unsupported" as const };
  }

  let claim: BillingEventClaim;
  try {
    claim = await claimBillingEvent(event);
  } catch (error) {
    console.error("[billing] event claim failed", { providerEventId: event.providerEventId, eventType: event.eventType, ...safeBillingErrorMetadata(error) });
    return { handled: false, retryable: true, reason: "claim" as const };
  }
  if (claim.kind !== "claimed") return { handled: true, retryable: false, duplicate: true, reason: claim.kind };

  const checkout = event.providerReference ? await prisma.billingCheckout.findUnique({ where: { reference: event.providerReference }, include: { subscription: true } }) : null;
  const recurringSubscription = !checkout && event.providerSubscriptionId
    ? await prisma.subscription.findFirst({ where: { provider: BillingProvider.PAYSTACK, providerSubscriptionId: event.providerSubscriptionId } })
    : null;
  const correlatedSubscription = checkout?.subscription ?? recurringSubscription;
  const businessId = checkout?.businessId ?? correlatedSubscription?.businessId;
  if (!correlatedSubscription || !businessId) {
    const persisted = await persistTerminalOutcome(claim, { failureCode: "CORRELATION_FAILED", failureStage: "correlation" }, event);
    return persisted ? { handled: false, retryable: false, reason: "correlation" as const } : { handled: false, retryable: true, reason: "processing" as const };
  }
  const expected = checkout ? { amount: checkout.amount, currency: checkout.currency, planCode: checkout.planCode, providerPlanCode: checkout.providerPlanCode } : { amount: getPlanDefinition(correlatedSubscription.planCode).monthlyPriceMinor, currency: getPlanDefinition(correlatedSubscription.planCode).currency, planCode: correlatedSubscription.planCode, providerPlanCode: correlatedSubscription.providerPlanCode ?? undefined };
  if ((event.amount !== undefined && event.amount !== expected.amount) || (event.currency && event.currency !== expected.currency)) {
    const persisted = await persistTerminalOutcome(claim, { businessId, failureCode: "VALIDATION_FAILED", failureStage: "validation" }, event);
    return persisted ? { handled: false, retryable: false, reason: "validation" as const } : { handled: false, retryable: true, reason: "processing" as const };
  }
  if (hasProviderSubscriptionConflict(correlatedSubscription, event)) {
    const persisted = await persistTerminalOutcome(claim, { businessId, failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT", failureStage: "provider_identity_conflict" }, event);
    return persisted ? { handled: false, retryable: false, reason: "provider_identity_conflict" as const } : { handled: false, retryable: true, reason: "processing" as const };
  }

  let processingStage = "transaction_start";
  try {
    return await prisma.$transaction(async (tx) => {
      processingStage = "claim_context";
      const owned = await tx.billingEvent.updateMany({ where: { id: claim.id, status: BillingEventStatus.PROCESSING, processingToken: claim.token }, data: { businessId } });
      if (owned.count !== 1) throw new LostBillingEventClaimError();
      processingStage = "provider_identity_fence";
      // The earlier snapshot is only a fast rejection. Use current, tenant-
      // scoped state for every identity/credential/date fallback below.
      const subscription = await tx.subscription.findUnique({ where: { id: correlatedSubscription.id, businessId } });
      if (!subscription || subscription.businessId !== businessId) throw new BillingCorrelationError("Subscription correlation changed");
      if (hasProviderSubscriptionConflict(subscription, event)) throw new ProviderSubscriptionConflictError();
      const occurredAt = event.occurredAt ?? new Date();
      if (event.eventType === "subscription.create") {
        processingStage = "subscription_identity";
        await tx.subscription.update({ where: { id: subscription.id }, data: { provider: BillingProvider.PAYSTACK, providerCustomerId: event.providerCustomerId ?? subscription.providerCustomerId, providerSubscriptionId: event.providerSubscriptionId ?? subscription.providerSubscriptionId, providerEmailToken: event.providerEmailToken ?? subscription.providerEmailToken, providerPlanCode: event.providerPlanCode ?? subscription.providerPlanCode } });
      } else if (event.eventType === "subscription.not_renew") {
        processingStage = "provider_not_renew";
        await tx.subscription.update({ where: { id: subscription.id }, data: { ...providerNonRenewingState(event.currentPeriodEndsAt ?? subscription.currentPeriodEndsAt), providerEmailToken: event.providerEmailToken ?? subscription.providerEmailToken } });
      } else if (event.eventType === "subscription.disable") {
        processingStage = "provider_disable";
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.CANCELLED, cancelAtPeriodEnd: true, providerEmailToken: event.providerEmailToken ?? subscription.providerEmailToken, currentPeriodEndsAt: event.currentPeriodEndsAt ?? subscription.currentPeriodEndsAt } });
      } else if (event.eventType === "charge.success") {
        processingStage = "invoice_upsert";
        await tx.billingInvoice.upsert({ where: { provider_providerReference: { provider: BillingProvider.PAYSTACK, providerReference: event.providerReference! } }, create: { businessId, subscriptionId: subscription.id, provider: BillingProvider.PAYSTACK, providerReference: event.providerReference ?? event.providerEventId, amount: expected.amount, currency: expected.currency, status: BillingInvoiceStatus.PAID, paidAt: occurredAt, occurredAt }, update: { status: BillingInvoiceStatus.PAID, paidAt: occurredAt, occurredAt } });
        processingStage = "subscription_activation";
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.ACTIVE, planCode: expected.planCode, provider: BillingProvider.PAYSTACK, providerCustomerId: event.providerCustomerId ?? subscription.providerCustomerId, providerSubscriptionId: event.providerSubscriptionId ?? subscription.providerSubscriptionId, providerEmailToken: event.providerEmailToken ?? subscription.providerEmailToken, providerPlanCode: event.providerPlanCode ?? expected.providerPlanCode, currentPeriodEndsAt: event.currentPeriodEndsAt ?? subscription.currentPeriodEndsAt, graceEndsAt: null, pastDueEndsAt: null } });
        processingStage = "referral_reward";
        await rewardReferralForVerifiedPayment(businessId, tx);
        if (checkout) { processingStage = "checkout_completion"; await tx.billingCheckout.update({ where: { id: checkout.id }, data: { status: "COMPLETED", completedAt: occurredAt } }); }
        processingStage = "activation_audit";
        await tx.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: subscription.id, action: "subscription_activated", newValue: JSON.stringify({ planCode: expected.planCode, reference: event.providerReference }) } });
      } else if (subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.PAST_DUE) {
        processingStage = "failure_invoice_upsert";
        await tx.billingInvoice.upsert({ where: { provider_providerReference: { provider: BillingProvider.PAYSTACK, providerReference: event.providerReference! } }, create: { businessId, subscriptionId: subscription.id, provider: BillingProvider.PAYSTACK, providerReference: event.providerReference ?? event.providerEventId, amount: expected.amount, currency: expected.currency, status: BillingInvoiceStatus.FAILED, occurredAt }, update: { status: BillingInvoiceStatus.FAILED, paidAt: null, occurredAt } });
        processingStage = "past_due_transition";
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.PAST_DUE, pastDueEndsAt: new Date(occurredAt.getTime() + Number(process.env.PAST_DUE_RECOVERY_DAYS ?? 3) * 86400000), provider: BillingProvider.PAYSTACK, providerCustomerId: event.providerCustomerId ?? subscription.providerCustomerId, providerSubscriptionId: event.providerSubscriptionId ?? subscription.providerSubscriptionId, providerEmailToken: event.providerEmailToken ?? subscription.providerEmailToken, providerPlanCode: event.providerPlanCode ?? expected.providerPlanCode } });
        processingStage = "failure_audit";
        await tx.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: subscription.id, action: "subscription_payment_failed", newValue: JSON.stringify({ reference: event.providerReference }) } });
      } else {
        throw new BillingCorrelationError("Payment failure is not tied to an active paid subscription");
      }
      processingStage = "event_processed";
      const completed = await tx.billingEvent.updateMany({ where: { id: claim.id, status: BillingEventStatus.PROCESSING, processingToken: claim.token }, data: { status: BillingEventStatus.PROCESSED, processedAt: new Date(), processingToken: null, failureCode: null, failureStage: null } });
      if (completed.count !== 1) throw new LostBillingEventClaimError();
      return { handled: true, retryable: false, duplicate: false };
    // A competing attachment after the re-read must abort, not overwrite.
    // Serialization failures follow the existing FAILED -> retry / HTTP 503
    // path; a later delivery rechecks identity and rejects a real conflict.
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof LostBillingEventClaimError) return { handled: true, retryable: false, duplicate: true, reason: "processing" as const };
    if (error instanceof ProviderSubscriptionConflictError) {
      const persisted = await persistTerminalOutcome(claim, { businessId, failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT", failureStage: "provider_identity_conflict" }, event);
      return persisted ? { handled: false, retryable: false, reason: "provider_identity_conflict" as const } : { handled: false, retryable: true, reason: "processing" as const };
    }
    if (error instanceof BillingCorrelationError) {
      const persisted = await persistTerminalOutcome(claim, { businessId, failureCode: "CORRELATION_FAILED", failureStage: processingStage }, event);
      return persisted ? { handled: false, retryable: false, reason: "correlation" as const } : { handled: false, retryable: true, reason: "processing" as const };
    }
    const failureCode = failureCodeFor(error);
    console.error("[billing] verified Paystack event processing failed", { providerEventId: event.providerEventId, eventType: event.eventType, stage: processingStage, ...safeBillingErrorMetadata(error) });
    await failClaim(claim, { businessId, failureCode, failureStage: processingStage });
    return { handled: false, retryable: true, reason: "processing" as const };
  }
}
