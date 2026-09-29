import { PlanCode, Prisma, Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const TRIAL_DURATION_DAYS = 14;
export const GRACE_PERIOD_DURATION_DAYS = 3;

export type SubscriptionAccessState = "FULL_ACCESS" | "RECOVERY" | "SUSPENDED";

export interface SubscriptionSummary {
  planCode: PlanCode;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  accessState: SubscriptionAccessState;
  trialDaysRemaining: number | null;
}

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

export function summarizeSubscription(subscription: Subscription, now = new Date()): SubscriptionSummary {
  const trialDaysRemaining = subscription.status === "TRIALING" && subscription.trialEndsAt
    ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    planCode: subscription.planCode,
    status: subscription.status,
    trialEndsAt: subscription.trialEndsAt,
    graceEndsAt: subscription.graceEndsAt,
    currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    accessState: deriveSubscriptionAccessState(subscription.status),
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
