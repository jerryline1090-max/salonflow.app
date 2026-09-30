import { Router } from "express";
import { getPlanDefinition } from "../modules/subscriptions/planConfig";
import { getBusinessSubscription, resolveBusinessAccess, summarizeSubscription } from "../modules/subscriptions/subscriptionService";
import { PlanCode } from "@prisma/client";
import { BillingCorrelationError, getBillingHistory, initializeBusinessCheckout, scheduleCancellation, undoScheduledCancellation } from "../modules/billing/billingService";
import { createPaystackProvider } from "../modules/billing/paystack/paystackProviderFactory";

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

subscriptionRouter.get("/history", async (req, res, next) => {
  try {
    if (req.actor!.role !== "OWNER") return res.status(403).json({ error: "Billing history is available to the business owner only" });
    res.json(await getBillingHistory(req.actor!.businessId!));
  } catch (error) { next(error); }
});

subscriptionRouter.post("/cancel", async (req, res, next) => {
  try {
    if (req.actor!.role !== "OWNER") return res.status(403).json({ error: "Only the business owner can manage cancellation" });
    const subscription = await scheduleCancellation(req.actor!.businessId!, req.actor!.userId);
    res.json({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, currentPeriodEndsAt: subscription.currentPeriodEndsAt });
  } catch (error) { next(error); }
});

subscriptionRouter.post("/cancel/undo", async (req, res, next) => {
  try {
    if (req.actor!.role !== "OWNER") return res.status(403).json({ error: "Only the business owner can manage cancellation" });
    const subscription = await undoScheduledCancellation(req.actor!.businessId!, req.actor!.userId);
    res.json({ cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false, currentPeriodEndsAt: subscription?.currentPeriodEndsAt ?? null });
  } catch (error) { next(error); }
});

// Billing recovery remains available to an authenticated OWNER even when the
// business is suspended; all tenant identity and pricing are resolved server-side.
subscriptionRouter.post("/checkout", async (req, res, next) => {
  try {
    if (req.actor!.role !== "OWNER") return res.status(403).json({ error: "Only the business owner can start billing checkout" });
    const planCode = req.body?.planCode;
    if (!Object.values(PlanCode).includes(planCode)) return res.status(400).json({ error: "A valid subscription plan is required" });
    const checkout = await initializeBusinessCheckout({
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      planCode,
      provider: createPaystackProvider(),
    });
    res.status(201).json(checkout);
  } catch (error) {
    if (error instanceof BillingCorrelationError) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});
