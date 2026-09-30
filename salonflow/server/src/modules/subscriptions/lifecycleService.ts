import { Subscription, SubscriptionStatus } from "@prisma/client";

export const PAST_DUE_RECOVERY_DAYS = Number(process.env.PAST_DUE_RECOVERY_DAYS ?? 3);

export function evaluateSubscriptionLifecycle(subscription: Subscription, now = new Date()): { status: SubscriptionStatus; graceEndsAt?: Date; pastDueEndsAt?: Date } | null {
  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEndsAt && now >= subscription.currentPeriodEndsAt) return { status: "CANCELLED" };
  if (subscription.status === "TRIALING" && subscription.trialEndsAt && now >= subscription.trialEndsAt) return { status: "GRACE_PERIOD", graceEndsAt: new Date(subscription.trialEndsAt.getTime() + 3 * 86400000) };
  if (subscription.status === "GRACE_PERIOD" && subscription.graceEndsAt && now >= subscription.graceEndsAt) return { status: "SUSPENDED" };
  if (subscription.status === "PAST_DUE" && subscription.pastDueEndsAt && now >= subscription.pastDueEndsAt) return { status: "SUSPENDED" };
  return null;
}
