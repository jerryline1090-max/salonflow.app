import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { evaluateSubscriptionLifecycle } from "./lifecycleService";

const LIMIT = 100;

async function createLifecycleNotification(tx: any, subscription: any, eventKey: string, title: string, body: string) {
  try {
    await tx.subscriptionLifecycleEvent.create({ data: { subscriptionId: subscription.id, businessId: subscription.businessId, eventKey } });
    await tx.notification.create({ data: { businessId: subscription.businessId, type: "PAYMENT_OUTSTANDING", priority: "HIGH", audience: "OWNER", title, body, actionRequired: true } });
    return 1;
  } catch (error: any) {
    if (error?.code === "P2002") return 0;
    throw error;
  }
}

function dueTrialKeys(subscription: any, now: Date) {
  if (subscription.status !== "TRIALING" || !subscription.trialEndsAt) return [] as string[];
  const started = subscription.trialEndsAt.getTime() - 14 * 86400000;
  const day = Math.floor((now.getTime() - started) / 86400000) + 1;
  return [1, 7, 11, 13, 14].filter((milestone) => day >= milestone).map((milestone) => `trial.day${milestone}`);
}

export async function processCommercialLifecycle(now = new Date()) {
  const candidates = await prisma.subscription.findMany({
    where: { OR: [
      { status: "TRIALING", trialEndsAt: { lte: now } },
      { status: "GRACE_PERIOD", graceEndsAt: { lte: now } },
      { status: "PAST_DUE", pastDueEndsAt: { lte: now } },
      { cancelAtPeriodEnd: true, currentPeriodEndsAt: { lte: now } },
    ] }, orderBy: { updatedAt: "asc" }, take: LIMIT,
  });
  let transitioned = 0; let failed = 0; let notificationsCreated = 0;
  for (const candidate of candidates) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.subscription.findUnique({ where: { id: candidate.id } });
        if (!current) return { transitioned: false, reminders: 0 };
        // Evaluate milestones against the freshly-read pre-transition state so
        // day 14 is not lost when trial expiry is due in this same run.
        let preTransitionReminders = 0;
        for (const key of dueTrialKeys(current, now)) preTransitionReminders += await createLifecycleNotification(tx, current, key, "Your SalonFlow trial", "Your trial is active. Review your subscription when ready.");
        const transition = evaluateSubscriptionLifecycle(current, now);
        if (!transition || transition.status === current.status) {
          let reminders = preTransitionReminders;
          if (current.status === "GRACE_PERIOD" && current.graceEndsAt && now >= new Date(current.graceEndsAt.getTime() - 86400000)) reminders += await createLifecycleNotification(tx, current, "trial.grace_ending", "Grace period ending", "Your SalonFlow grace period ends soon.");
          if (current.status === "PAST_DUE" && current.pastDueEndsAt && now >= new Date(current.pastDueEndsAt.getTime() - 86400000)) reminders += await createLifecycleNotification(tx, current, "past_due.recovery", "Payment recovery needed", "Your subscription payment needs attention.");
          return { transitioned: false, reminders };
        }
        const updated = await tx.subscription.updateMany({ where: { id: current.id, status: current.status }, data: { status: transition.status, graceEndsAt: transition.graceEndsAt ?? current.graceEndsAt, pastDueEndsAt: transition.status === "SUSPENDED" ? current.pastDueEndsAt : transition.pastDueEndsAt ?? current.pastDueEndsAt } });
        if (updated.count !== 1) return { transitioned: false, reminders: 0 };
        await tx.auditLog.create({ data: { businessId: current.businessId, actorType: "SYSTEM", resource: "billing", resourceId: current.id, action: `lifecycle_${current.status.toLowerCase()}_${transition.status.toLowerCase()}` } });
        const key = transition.status === "GRACE_PERIOD" ? "trial.grace_started" : current.status === "GRACE_PERIOD" ? "trial.suspended" : current.status === "PAST_DUE" ? "past_due.suspended" : "cancellation.effective";
        const reminders = await createLifecycleNotification(tx, current, key, "Subscription update", transition.status === "SUSPENDED" ? "SalonFlow access is now restricted until billing is recovered." : "Your subscription status has changed.");
        return { transitioned: true, reminders: reminders + preTransitionReminders };
      });
      if (result.transitioned) transitioned++;
      notificationsCreated += result.reminders;
    } catch { failed++; }
  }
  return { evaluated: candidates.length, transitioned, notificationsCreated, failed };
}
