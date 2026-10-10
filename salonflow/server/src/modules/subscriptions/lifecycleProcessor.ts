import { Prisma, Subscription } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { evaluateSubscriptionLifecycle } from "./lifecycleService";

const DAY = 86400000;
const LIMIT = 100;
const noop = { transitioned: false, reminders: 0, blocked: false, eventType: null as string | null };

// Pre-commercial read-only audit: find events with eventKey in this list.
// Never enable commercial jobs with unresolved records. No history repair.
export const AMBIGUOUS_LEGACY_KEYS = ["past_due.recovery", "past_due.suspended", "cancellation.effective"] as const;
type Action = { type: string; boundary: Date; title: string; body: string; transition: ReturnType<typeof evaluateSubscriptionLifecycle> };

function actionFor(s: Subscription, now: Date): Action | null {
  if (s.status === "CANCELLED") return null;
  const transition = evaluateSubscriptionLifecycle(s, now);
  if (transition && transition.status !== s.status) {
    const type = transition.status === "CANCELLED" ? "cancellation.effective"
      : transition.status === "GRACE_PERIOD" ? "trial.grace_started"
      : s.status === "GRACE_PERIOD" ? "trial.suspended" : "past_due.suspended";
    const boundary = type === "cancellation.effective" ? s.currentPeriodEndsAt
      : type === "trial.grace_started" ? s.trialEndsAt : type === "trial.suspended" ? s.graceEndsAt : s.pastDueEndsAt;
    if (!boundary) throw new Error("Missing lifecycle boundary");
    return { type, boundary, transition, title: "Subscription update", body: transition.status === "SUSPENDED"
      ? "SalonFlow access is now restricted until billing is recovered." : "Your subscription status has changed." };
  }
  if (s.status === "TRIALING" && s.trialEndsAt && now < s.trialEndsAt) {
    const day = Math.floor((now.getTime() - (s.trialEndsAt.getTime() - 14 * DAY)) / DAY) + 1;
    const milestone = [14, 13, 11, 7, 1].find(value => day >= value);
    if (milestone) return { type: `trial.day${milestone}`, boundary: s.trialEndsAt, transition: null,
      title: "Your SalonFlow trial", body: "Your trial is active. Review your subscription when ready." };
  }
  const boundary = s.status === "GRACE_PERIOD" ? s.graceEndsAt : s.status === "PAST_DUE" ? s.pastDueEndsAt : null;
  if (boundary && now.getTime() >= boundary.getTime() - DAY && now < boundary) return {
    type: s.status === "GRACE_PERIOD" ? "trial.grace_ending" : "past_due.recovery", boundary, transition: null,
    title: s.status === "GRACE_PERIOD" ? "Grace period ending" : "Payment recovery needed",
    body: s.status === "GRACE_PERIOD" ? "Your SalonFlow grace period ends soon." : "Your subscription payment needs attention.",
  };
  return null;
}

// Trial/grace are one initial trial in this model. Earlier-than-trial-start
// legacy events are prior. Grace additionally requires the original 3-day deadline.
function legacyOutcome(s: Subscription, action: Action, createdAt: Date): "SAME" | "PRIOR" | "AMBIGUOUS" {
  if ((AMBIGUOUS_LEGACY_KEYS as readonly string[]).includes(action.type)) return "AMBIGUOUS";
  if (!s.trialEndsAt) return "AMBIGUOUS";
  if (action.type === "trial.grace_ending" || action.type === "trial.suspended") {
    if (!s.graceEndsAt || s.graceEndsAt.getTime() !== s.trialEndsAt.getTime() + 3 * DAY) return "AMBIGUOUS";
  }
  return createdAt.getTime() < s.trialEndsAt.getTime() - 14 * DAY ? "PRIOR" : "SAME";
}
class DuplicateTransition extends Error {}

async function processOne(id: string, now: Date) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const current = await tx.subscription.findUnique({ where: { id } });
        if (!current) return noop;
        const action = actionFor(current, now);
        if (!action) return noop;
        const eventKey = `v2:${action.type}:${action.boundary.toISOString()}`;
        const legacy = await tx.subscriptionLifecycleEvent.findUnique({
          where: { subscriptionId_eventKey: { subscriptionId: id, eventKey: action.type } },
        });
        if (legacy) {
          const compatibility = legacyOutcome(current, action, legacy.createdAt);
          if (compatibility === "AMBIGUOUS") return { ...noop, blocked: true, eventType: action.type };
          if (compatibility === "SAME") return noop;
        }
        if (action.transition) {
          const updated = await tx.subscription.updateMany({
            // Fence every evaluated state/deadline, including cancellation races.
            where: { id, status: current.status, trialEndsAt: current.trialEndsAt,
              graceEndsAt: current.graceEndsAt, pastDueEndsAt: current.pastDueEndsAt,
              currentPeriodEndsAt: current.currentPeriodEndsAt, cancelAtPeriodEnd: current.cancelAtPeriodEnd },
            data: { status: action.transition.status,
              ...(action.transition.graceEndsAt ? { graceEndsAt: action.transition.graceEndsAt } : {}) },
          });
          if (updated.count !== 1) return noop;
        }
        const claimed = await tx.subscriptionLifecycleEvent.createMany({
          data: [{ subscriptionId: id, businessId: current.businessId, eventKey }], skipDuplicates: true,
        });
        if (claimed.count !== 1) {
          // Roll back any state write when this logical transition already exists.
          // This is not a database error; never catch P2002 inside a transaction.
          if (action.transition) throw new DuplicateTransition();
          return noop;
        }
        if (action.transition) await tx.auditLog.create({ data: { businessId: current.businessId,
          actorType: "SYSTEM", resource: "billing", resourceId: id,
          action: `lifecycle_${current.status.toLowerCase()}_${action.transition.status.toLowerCase()}` } });
        await tx.notification.create({ data: { businessId: current.businessId, type: "PAYMENT_OUTSTANDING",
          priority: "HIGH", audience: "OWNER", title: action.title, body: action.body, actionRequired: true } });
        return { transitioned: Boolean(action.transition), reminders: 1, blocked: false, eventType: action.type };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof DuplicateTransition) return noop;
      // Retry only complete rolled-back serialization conflicts, at most 3 attempts.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}

export async function processCommercialLifecycle(now = new Date()) {
  const eligibility: Prisma.SubscriptionWhereInput = { OR: [
    { status: "TRIALING", trialEndsAt: { lte: new Date(now.getTime() + 14 * DAY) } },
    { status: "GRACE_PERIOD", graceEndsAt: { lte: new Date(now.getTime() + DAY) } },
    { status: "PAST_DUE", pastDueEndsAt: { lte: new Date(now.getTime() + DAY) } },
    { status: { not: "CANCELLED" }, cancelAtPeriodEnd: true, currentPeriodEndsAt: { lte: now } },
  ] };
  const result = { evaluated: 0, transitioned: 0, notificationsCreated: 0, failed: 0, blocked: 0 };
  let after: string | undefined;
  for (;;) {
    const candidates = await prisma.subscription.findMany({
      where: { ...eligibility, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" }, take: LIMIT, select: { id: true },
    });
    if (!candidates.length) break;
    for (const candidate of candidates) {
      after = candidate.id;
      result.evaluated++;
      try {
        const outcome = await processOne(candidate.id, now);
        if (outcome.blocked) {
          result.blocked++;
          console.warn("Commercial lifecycle blocked", { code: "LEGACY_AMBIGUOUS", subscriptionId: candidate.id, eventType: outcome.eventType });
        }
        if (outcome.transitioned) result.transitioned++;
        result.notificationsCreated += outcome.reminders;
      } catch (error) {
        result.failed++;
        console.error("Commercial lifecycle failed", { subscriptionId: candidate.id,
          code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "PROCESSING_FAILED" });
      }
    }
    if (candidates.length < LIMIT) break;
  }
  return result;
}
