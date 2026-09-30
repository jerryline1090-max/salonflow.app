import { Router } from "express";
import { getReferralSummary } from "../modules/referrals/referralService";

export const referralsRouter = Router();

// Commercial referral data is owner-only and always scoped from the trusted
// authenticated business context, never from a browser-supplied business id.
referralsRouter.get("/", async (req, res, next) => {
  try {
    if (req.actor!.role !== "OWNER") {
      return res.status(403).json({ error: "Referral and credit details are available to the business owner only" });
    }
    res.json(await getReferralSummary(req.actor!.businessId!));
  } catch (error) {
    next(error);
  }
});
