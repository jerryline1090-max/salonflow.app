import { Prisma, Subscription } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BillingProviderAdapter, BillingProviderError, DiscoveredSubscription, VerifiedInitialPayment } from "./billingProvider";
import { providerNonRenewingState } from "./providerRenewalState";

export type ReconciliationOutcome = "reconciled" | "already_reconciled" | "not_found" | "ambiguous" | "conflict" | "provider_unavailable" | "indeterminate";
// Only this small result may leave the service: provider credentials never do.
const result = (outcome: ReconciliationOutcome) => ({ outcome, reconciled: outcome === "reconciled" || outcome === "already_reconciled", changed: outcome === "reconciled" });
const eligible = (s: Subscription | null) => s?.status === "ACTIVE" && s.provider === "PAYSTACK" && !!s.providerCustomerId && !!s.providerPlanCode;

export async function discoverMissingSubscription(businessId: string, provider: BillingProviderAdapter) {
  try {
    const initial = await prisma.subscription.findUnique({ where: { businessId } });
    if (!eligible(initial) || !initial || !provider.verifyInitialPayment || !provider.discoverSubscriptions) return result("indeterminate");
    // A unique completed initial checkout is required. Never pick the first of
    // several potentially unrelated payment/subscription lifecycles.
    const checkouts = await prisma.billingCheckout.findMany({ where: { businessId, subscriptionId: initial.id, provider: "PAYSTACK", status: "COMPLETED" }, take: 2 });
    if (checkouts.length > 1) return result("ambiguous");
    const checkout = checkouts[0];
    if (!checkout || checkout.planCode !== initial.planCode || checkout.providerPlanCode !== initial.providerPlanCode) return result("indeterminate");
    const payment = await provider.verifyInitialPayment({ reference: checkout.reference, amount: checkout.amount, currency: checkout.currency,
      providerCustomerId: initial.providerCustomerId!, providerPlanCode: initial.providerPlanCode! });
    if (!await evidence(prisma, payment, initial.id, businessId, checkout.id, initial.planCode)) return result("indeterminate");
    const discovery = await provider.discoverSubscriptions(payment);
    if (discovery.outcome !== "exactly_one") return result(discovery.outcome);
    const candidate = discovery.candidate;
    if (!consistentCandidate(candidate, payment)) return result("indeterminate");

    try {
      // Required race-safe verification reads over remote PostgreSQL need a
      // bounded extended budget; all provider I/O has already completed.
      return await prisma.$transaction(async tx => {
        const current = await tx.subscription.findUnique({ where: { businessId } });
        if (!current || current.id !== initial.id || !eligible(current) || current.planCode !== initial.planCode
          || current.providerCustomerId !== payment.providerCustomerId || current.providerPlanCode !== payment.providerPlanCode
          || !await evidence(tx, payment, initial.id, businessId, checkout.id, initial.planCode)) return result("conflict");
        const owner = await tx.subscription.findFirst({ where: { providerSubscriptionId: candidate.providerSubscriptionId, NOT: { id: current.id } }, select: { id: true } });
        if (owner) return result("conflict");
        if (current.providerSubscriptionId) return result(current.providerSubscriptionId === candidate.providerSubscriptionId ? "already_reconciled" : "conflict");
        const update = await tx.subscription.updateMany({
          where: { id: current.id, businessId, provider: "PAYSTACK", providerSubscriptionId: null, status: "ACTIVE", updatedAt: current.updatedAt,
            providerCustomerId: payment.providerCustomerId, providerPlanCode: payment.providerPlanCode },
          data: { provider: "PAYSTACK", providerSubscriptionId: candidate.providerSubscriptionId, providerEmailToken: candidate.providerEmailToken,
            currentPeriodEndsAt: candidate.currentPeriodEndsAt,
            ...(candidate.status === "NON_RENEWING" ? providerNonRenewingState(candidate.currentPeriodEndsAt) : {}) },
        });
        if (update.count !== 1) return raceResult(tx, businessId, initial.id, candidate);
        await tx.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: current.id,
          action: "subscription_provider_discovered", newValue: JSON.stringify({ provider: "PAYSTACK", providerSubscriptionId: candidate.providerSubscriptionId, reason: "verified_initial_payment" }) } });
        return result("reconciled");
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "P2002" || code === "P2034") return await raceResult(prisma, businessId, initial.id, candidate);
      return result("indeterminate");
    }
  } catch (error) {
    return result(error instanceof BillingProviderError && ["TIMEOUT", "UNAVAILABLE", "REJECTED"].includes(error.kind) ? "provider_unavailable" : "indeterminate");
  }
}

async function evidence(db: Prisma.TransactionClient, p: VerifiedInitialPayment, subscriptionId: string, businessId: string, checkoutId: string, planCode: Subscription["planCode"]) {
  const checkout = await db.billingCheckout.findFirst({ where: { id: checkoutId, businessId, subscriptionId, provider: "PAYSTACK", status: "COMPLETED", reference: p.reference,
    amount: p.amount, currency: p.currency, providerPlanCode: p.providerPlanCode, planCode }, select: { id: true } });
  const invoice = await db.billingInvoice.findFirst({ where: { businessId, subscriptionId, provider: "PAYSTACK", providerReference: p.reference, status: "PAID", amount: p.amount, currency: p.currency }, select: { id: true } });
  const event = await db.billingEvent.findFirst({ where: { businessId, provider: "PAYSTACK", providerEventId: `charge.success:${p.transactionId}`, eventType: "charge.success", status: "PROCESSED" }, select: { id: true } });
  return Boolean(checkout && invoice && event);
}

function consistentCandidate(c: DiscoveredSubscription, p: VerifiedInitialPayment) {
  const delta = c.createdAt.getTime() - p.paidAt.getTime();
  return c.providerCustomerId === p.providerCustomerId && c.providerPlanCode === p.providerPlanCode
    && !!c.providerSubscriptionId && !!c.providerEmailToken && Number.isFinite(delta) && delta >= -120_000 && delta <= 600_000
    && Number.isFinite(c.currentPeriodEndsAt.getTime()) && c.currentPeriodEndsAt > c.createdAt && ["ACTIVE", "NON_RENEWING"].includes(c.status);
}

async function raceResult(db: Prisma.TransactionClient, businessId: string, id: string, candidate: DiscoveredSubscription) {
  const current = await db.subscription.findUnique({ where: { businessId } });
  const owner = await db.subscription.findFirst({ where: { providerSubscriptionId: candidate.providerSubscriptionId, NOT: { id } }, select: { id: true } });
  return result(!owner && current?.id === id && current.provider === "PAYSTACK" && current.providerSubscriptionId === candidate.providerSubscriptionId
    && current.providerCustomerId === candidate.providerCustomerId && current.providerPlanCode === candidate.providerPlanCode ? "already_reconciled" : "conflict");
}
