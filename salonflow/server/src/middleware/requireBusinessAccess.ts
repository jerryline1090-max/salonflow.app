import { NextFunction, Request, Response } from "express";
import { getBusinessSubscription, resolveBusinessAccess } from "../modules/subscriptions/subscriptionService";

/** Central commercial gate for all authenticated operational API routes. */
export async function requireBusinessAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.actor?.businessId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const access = resolveBusinessAccess(await getBusinessSubscription(req.actor.businessId));
    if (!access.allowed) {
      return res.status(403).json({
        error: access.accessState === "UNAVAILABLE" ? "Business subscription is unavailable. Please contact SalonFlow support." : "Business subscription needs owner attention before operational access can continue.",
        code: "BUSINESS_ACCESS_RESTRICTED",
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}
