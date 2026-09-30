import { PlanCode, Prisma, Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const TRIAL_DURATION_DAYS = 14;
export const GRACE_PERIOD_DURATION_DAYS = 3;

export type SubscriptionAccessState = "FULL_ACCESS" | "RECOVERY" | "SUSPENDED";

export interface BusinessAccessResolution {
  accessState: SubscriptionAccessState | "UNAVAILABLE";
  allowed: boolean;
  effectiveStatus: SubscriptionStatus | null;
  warning: "PAST_DUE" | "GRACE_PERIOD" | "TRIAL_ENDING" | null;
  graceEndsAt: Date | null;
}

export interface SubscriptionSummary {
  planCode: PlanCode;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  accessState: SubscriptionAccessState;
  accessAllowed: boolean;
  warning: BusinessAccessResolution["warning"];
  trialDaysRemaining: number | null;
}

// Access decisions intentionally depend only on commercial lifecycle fields,
// not provider implementation details.
type SubscriptionAccessRecord = Pick<Subscription, "id" | "businessId" | "planCode" | "status" | "trialEndsAt" | "graceEndsAt" | "currentPeriodEndsAt" | "cancelAtPeriodEnd" | "createdAt" | "updatedAt">;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// The future lifecycle worker persists GRACE_PERIOD when a trial expires.
// Keeping the deadline calculation here ensures that worker and UI use the
// same fixed three-day policy without introducing enforcement in this phase.
export function getGracePeriodEndsAt(trialEndsAt: Date): Date {
  return addDays(trialEndsAt, GRACE_PERIOD_DURATION_DAYS);
}

export function createTrialSubscription(now = new Date()): Prisma.SubscriptionCreateWithoutBusinessInput {
  return {
    planCode: "STARTER",
    status: "TRIALING",
    trialEndsAt: addDays(now, TRIAL_DURATION_DAYS),
    graceEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
  };
}

export function deriveSubscriptionAccessState(status: SubscriptionStatus): SubscriptionAccessState {
  switch (status) {
    case "TRIALING":
    case "ACTIVE":
      return "FULL_ACCESS";
    case "PAST_DUE":
    case "GRACE_PERIOD":
      return "RECOVERY";
    case "SUSPENDED":
    case "CANCELLED":
      return "SUSPENDED";
  }
}

/**
 * The database status is the source of truth, with persisted dates resolving
 * the few time-based edges before a future lifecycle worker persists them.
 * Legacy ACTIVE rows with no period end deliberately remain allowed until a
 * production reconciliation establishes their paid renewal date.
 */
export function resolveBusinessAccess(subscription: SubscriptionAccessRecord | null, now = new Date()): BusinessAccessResolution {
  if (!subscription) return { accessState: "UNAVAILABLE", allowed: false, effectiveStatus: null, warning: null, graceEndsAt: null };

  if (subscription.status === "TRIALING" && subscription.trialEndsAt && now >= subscription.trialEndsAt) {
    const graceEndsAt = subscription.graceEndsAt ?? getGracePeriodEndsAt(subscription.trialEndsAt);
    if (now < graceEndsAt) return { accessState: "RECOVERY", allowed: true, effectiveStatus: "GRACE_PERIOD", warning: "GRACE_PERIOD", graceEndsAt };
    return { accessState: "SUSPENDED", allowed: false, effectiveStatus: "SUSPENDED", warning: null, graceEndsAt };
  }

  if (subscription.status === "CANCELLED") {
    const stillInPaidPeriod = subscription.currentPeriodEndsAt && now < subscription.currentPeriodEndsAt;
    return { accessState: stillInPaidPeriod ? "FULL_ACCESS" : "SUSPENDED", allowed: Boolean(stillInPaidPeriod), effectiveStatus: "CANCELLED", warning: null, graceEndsAt: null };
  }

  switch (subscription.status) {
    case "TRIALING":
      return { accessState: "FULL_ACCESS", allowed: true, effectiveStatus: "TRIALING", warning: null, graceEndsAt: null };
    case "ACTIVE":
      return { accessState: "FULL_ACCESS", allowed: true, effectiveStatus: "ACTIVE", warning: null, graceEndsAt: null };
    case "PAST_DUE":
      return { accessState: "RECOVERY", allowed: true, effectiveStatus: "PAST_DUE", warning: "PAST_DUE", graceEndsAt: null };
    case "GRACE_PERIOD":
      {
        const graceEndsAt = subscription.graceEndsAt ?? (subscription.trialEndsAt ? getGracePeriodEndsAt(subscription.trialEndsAt) : null);
        if (!graceEndsAt || now >= graceEndsAt) {
          return { accessState: "SUSPENDED", allowed: false, effectiveStatus: "SUSPENDED", warning: null, graceEndsAt };
        }
        return { accessState: "RECOVERY", allowed: true, effectiveStatus: "GRACE_PERIOD", warning: "GRACE_PERIOD", graceEndsAt };
      }
    case "SUSPENDED":
      return { accessState: "SUSPENDED", allowed: false, effectiveStatus: "SUSPENDED", warning: null, graceEndsAt: null };
  }
}

export function summarizeSubscription(subscription: SubscriptionAccessRecord, now = new Date()): SubscriptionSummary {
  const access = resolveBusinessAccess(subscription, now);
  const trialDaysRemaining = access.effectiveStatus === "TRIALING" && subscription.trialEndsAt
    ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    planCode: subscription.planCode,
    status: access.effectiveStatus ?? subscription.status,
    trialEndsAt: subscription.trialEndsAt,
    graceEndsAt: access.graceEndsAt ?? subscription.graceEndsAt,
    currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    accessState: access.accessState as SubscriptionAccessState,
    accessAllowed: access.allowed,
    warning: access.warning,
    trialDaysRemaining,
  };
}

export async function getBusinessSubscription(businessId: string): Promise<Subscription | null> {
  return prisma.subscription.findUnique({ where: { businessId } });
}

export async function getBusinessSubscriptionSummary(businessId: string): Promise<SubscriptionSummary | null> {
  const subscription = await getBusinessSubscription(businessId);
  return subscription ? summarizeSubscription(subscription) : null;
}
