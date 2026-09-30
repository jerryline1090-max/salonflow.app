import { BillingEventStatus, BillingInvoiceStatus, BillingProvider, PlanCode, SubscriptionStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { getPlanDefinition } from "../subscriptions/planConfig";
import { BillingProviderAdapter, BillingProviderError, NormalizedBillingEvent } from "./billingProvider";

export class BillingCorrelationError extends Error {}

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

  const plan = getPlanDefinition(input.planCode);
  const providerPlanCode = input.provider.getPlanCode?.(input.planCode);
  if (!providerPlanCode) throw new BillingProviderError("CONFIGURATION", "Billing provider plan mapping is unavailable");

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
      metadata: { checkoutId: checkout.id, checkoutReference: reference, businessId: business.id, subscriptionId: business.subscription.id, planCode: input.planCode },
    });
    await prisma.auditLog.create({ data: { businessId: business.id, actorUserId: input.actorUserId, actorType: "USER", resource: "billing", resourceId: checkout.id, action: "checkout_initiated", newValue: JSON.stringify({ planCode: input.planCode, reference }) } });
    return { authorizationUrl: result.authorizationUrl, accessCode: result.accessCode, reference: result.providerReference };
  } catch (error) {
    await prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export async function processVerifiedPaystackEvent(event: NormalizedBillingEvent) {
  if (event.provider !== "PAYSTACK" || !["charge.success", "invoice.payment_failed", "subscription.create"].includes(event.eventType)) {
    return { handled: false, reason: "unsupported" as const };
  }

  const existing = await prisma.billingEvent.findUnique({ where: { provider_providerEventId: { provider: BillingProvider.PAYSTACK, providerEventId: event.providerEventId } } });
  if (existing) return { handled: true, duplicate: true };

  const checkout = event.providerReference ? await prisma.billingCheckout.findUnique({ where: { reference: event.providerReference }, include: { subscription: true } }) : null;
  const recurringSubscription = !checkout && event.providerSubscriptionId
    ? await prisma.subscription.findFirst({ where: { provider: BillingProvider.PAYSTACK, providerSubscriptionId: event.providerSubscriptionId } })
    : null;
  const subscription = checkout?.subscription ?? recurringSubscription;
  const businessId = checkout?.businessId ?? subscription?.businessId;
  if (!subscription || !businessId) {
    await recordFailedEvent(event, "CORRELATION_FAILED");
    return { handled: false, reason: "correlation" as const };
  }
  const expected = checkout ? { amount: checkout.amount, currency: checkout.currency, planCode: checkout.planCode, providerPlanCode: checkout.providerPlanCode } : { amount: getPlanDefinition(subscription.planCode).monthlyPriceMinor, currency: getPlanDefinition(subscription.planCode).currency, planCode: subscription.planCode, providerPlanCode: subscription.providerPlanCode ?? undefined };
  if ((event.amount !== undefined && event.amount !== expected.amount) || (event.currency && event.currency !== expected.currency)) {
    await recordFailedEvent(event, "VALIDATION_FAILED", businessId);
    return { handled: false, reason: "validation" as const };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.billingEvent.findUnique({ where: { provider_providerEventId: { provider: BillingProvider.PAYSTACK, providerEventId: event.providerEventId } } });
      if (duplicate) return { handled: true, duplicate: true };
      const billingEvent = await tx.billingEvent.create({ data: { provider: BillingProvider.PAYSTACK, providerEventId: event.providerEventId, eventType: event.eventType, businessId, status: BillingEventStatus.RECEIVED } });
      const occurredAt = event.occurredAt ?? new Date();
      if (event.eventType === "subscription.create") {
        // Identity only: verified creation is not proof of a paid charge.
        await tx.subscription.update({ where: { id: subscription.id }, data: { provider: BillingProvider.PAYSTACK, providerCustomerId: event.providerCustomerId ?? subscription.providerCustomerId, providerSubscriptionId: event.providerSubscriptionId ?? subscription.providerSubscriptionId, providerPlanCode: event.providerPlanCode ?? subscription.providerPlanCode } });
      } else if (event.eventType === "charge.success") {
        await tx.billingInvoice.upsert({
          where: { provider_providerReference: { provider: BillingProvider.PAYSTACK, providerReference: event.providerReference! } },
          create: { businessId, subscriptionId: subscription.id, provider: BillingProvider.PAYSTACK, providerReference: event.providerReference ?? event.providerEventId, amount: expected.amount, currency: expected.currency, status: BillingInvoiceStatus.PAID, paidAt: occurredAt, occurredAt },
          update: { status: BillingInvoiceStatus.PAID, paidAt: occurredAt, occurredAt },
        });
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.ACTIVE, planCode: expected.planCode, provider: BillingProvider.PAYSTACK, providerCustomerId: event.providerCustomerId ?? subscription.providerCustomerId, providerSubscriptionId: event.providerSubscriptionId ?? subscription.providerSubscriptionId, providerPlanCode: event.providerPlanCode ?? expected.providerPlanCode, currentPeriodEndsAt: event.currentPeriodEndsAt ?? subscription.currentPeriodEndsAt, graceEndsAt: null } });
        if (checkout) await tx.billingCheckout.update({ where: { id: checkout.id }, data: { status: "COMPLETED", completedAt: occurredAt } });
        await tx.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: subscription.id, action: "subscription_activated", newValue: JSON.stringify({ planCode: expected.planCode, reference: event.providerReference }) } });
      } else if (subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.PAST_DUE) {
        await tx.billingInvoice.upsert({
          where: { provider_providerReference: { provider: BillingProvider.PAYSTACK, providerReference: event.providerReference! } },
          create: { businessId, subscriptionId: subscription.id, provider: BillingProvider.PAYSTACK, providerReference: event.providerReference ?? event.providerEventId, amount: expected.amount, currency: expected.currency, status: BillingInvoiceStatus.FAILED, occurredAt },
          update: { status: BillingInvoiceStatus.FAILED, paidAt: null, occurredAt },
        });
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.PAST_DUE, provider: BillingProvider.PAYSTACK, providerCustomerId: event.providerCustomerId ?? subscription.providerCustomerId, providerSubscriptionId: event.providerSubscriptionId ?? subscription.providerSubscriptionId, providerPlanCode: event.providerPlanCode ?? expected.providerPlanCode } });
        await tx.auditLog.create({ data: { businessId, actorType: "SYSTEM", resource: "billing", resourceId: subscription.id, action: "subscription_payment_failed", newValue: JSON.stringify({ reference: event.providerReference }) } });
      } else {
        throw new BillingCorrelationError("Payment failure is not tied to an active paid subscription");
      }
      await tx.billingEvent.update({ where: { id: billingEvent.id }, data: { status: BillingEventStatus.PROCESSED, processedAt: new Date() } });
      return { handled: true, duplicate: false };
    });
  } catch (error) {
    await recordFailedEvent(event, error instanceof BillingCorrelationError ? "CORRELATION_FAILED" : "PROCESSING_FAILED", businessId);
    return { handled: false, reason: "processing" as const };
  }
}

async function recordFailedEvent(event: NormalizedBillingEvent, failureCode: string, businessId?: string) {
  try {
    await prisma.billingEvent.create({ data: { provider: BillingProvider.PAYSTACK, providerEventId: event.providerEventId, eventType: event.eventType, businessId, status: BillingEventStatus.FAILED, failureCode, processedAt: new Date() } });
  } catch {
    // A concurrent delivery already owns this idempotency key; never retry a mutation here.
  }
}
