import { Router, Response, NextFunction } from "express";
import { getPlanDefinition } from "../modules/subscriptions/planConfig";
import { getBusinessSubscription, resolveBusinessAccess, summarizeSubscription } from "../modules/subscriptions/subscriptionService";
import { PlanCode } from "@prisma/client";
import { BillingCorrelationError, getBillingHistory, initializeBusinessCheckout, scheduleCancellation, undoScheduledCancellation } from "../modules/billing/billingService";
import { createPaystackProvider } from "../modules/billing/paystack/paystackProviderFactory";
import { BillingProviderError } from "../modules/billing/billingProvider";

export const subscriptionRouter = Router();

function cancellationError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof BillingCorrelationError) {
    return res.status(409).json({ error: "Cancellation cannot be changed in the current subscription state.", code: "BILLING_CANCELLATION_CONFLICT" });
  }
  if (!(error instanceof BillingProviderError)) return next(error);
  const conflict = error.rejectionCategory === "STATE_CONFLICT";
  const credential = error.rejectionCategory === "CREDENTIAL_INVALID";
  const status = conflict ? 409 : error.kind === "CONFIGURATION" ? 503 : error.kind === "TIMEOUT" ? 504 : 502;
  // No raw provider text, identity, token or exception message reaches logs/UI.
  console.error("Billing cancellation provider failure", { kind: error.kind, providerStatus: error.providerStatus,
    providerResponseStatus: error.providerResponseStatus, category: error.rejectionCategory });
  return res.status(status).json({
    error: conflict ? "The payment provider does not currently permit this cancellation change. Cancellation settings were not changed."
      : credential ? "The payment subscription needs verified reconciliation before cancellation can be changed. Contact SalonFlow support."
        : "The payment provider could not confirm this cancellation change. Cancellation settings were not changed.",
    code: conflict ? "BILLING_PROVIDER_STATE_CONFLICT" : credential ? "BILLING_RECONCILIATION_REQUIRED" : `BILLING_PROVIDER_${error.kind}`,
  });
}

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
    const subscription = await scheduleCancellation(req.actor!.businessId!, req.actor!.userId, createPaystackProvider());
    res.json({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, currentPeriodEndsAt: subscription.currentPeriodEndsAt });
  } catch (error) { cancellationError(error, res, next); }
});

subscriptionRouter.post("/cancel/undo", async (req, res, next) => {
  try {
    if (req.actor!.role !== "OWNER") return res.status(403).json({ error: "Only the business owner can manage cancellation" });
    const subscription = await undoScheduledCancellation(req.actor!.businessId!, req.actor!.userId, createPaystackProvider());
    res.json({ cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false, currentPeriodEndsAt: subscription?.currentPeriodEndsAt ?? null });
  } catch (error) { cancellationError(error, res, next); }
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
    if (error instanceof BillingProviderError) {
      console.error("Paystack checkout failed", { kind: error.kind, providerStatus: error.providerStatus, providerMessage: error.providerMessage });
      const status = error.kind === "CONFIGURATION" ? 503 : error.kind === "TIMEOUT" ? 504 : 502;
      return res.status(status).json({
        error: "Paystack could not initialize this checkout. Verify the configured plan and try again.",
        code: `BILLING_PROVIDER_${error.kind}`,
        ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}),
        // The adapter allowlists only Paystack's bounded top-level message.
        // Keep this diagnostic available locally, never in production responses.
        ...(process.env.NODE_ENV !== "production" && error.providerMessage ? { providerMessage: error.providerMessage } : {}),
      });
    }
    next(error);
  }
});
