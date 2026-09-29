import { Router } from "express";
import { getPlanDefinition } from "../modules/subscriptions/planConfig";
import { getBusinessSubscription, resolveBusinessAccess, summarizeSubscription } from "../modules/subscriptions/subscriptionService";

export const subscriptionRouter = Router();

// Recovery-safe: this route stays outside requireBusinessAccess. It exposes
// commercial data only, never operational salon records.
subscriptionRouter.get("/", async (req, res, next) => {
  try {
    const subscription = await getBusinessSubscription(req.actor!.businessId!);
    const access = resolveBusinessAccess(subscription);
    if (!subscription) return res.status(503).json({ error: "Business subscription is unavailable. Please contact SalonFlow support." });
    const summary = summarizeSubscription(subscription);
    if (req.actor!.role !== "OWNER") {
      return res.json({ status: summary.status, accessState: summary.accessState, accessAllowed: summary.accessAllowed });
    }
    const plan = getPlanDefinition(subscription.planCode);
    res.json({ ...summary, displayName: plan.displayName, currency: plan.currency, monthlyPriceMinor: plan.monthlyPriceMinor, effectiveAccess: access.accessState });
  } catch (error) {
    next(error);
  }
});
