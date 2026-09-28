import { Router } from "express";
import { OnboardingAccessError, advanceOnboarding, completeOnboarding, createOnboardingService, getOnboardingReview, getOnboardingState, saveOnboardingBusinessHours, skipOnboardingStep } from "../modules/onboarding/onboardingService";

export const onboardingRouter = Router();
const handler = (fn: (req: any) => Promise<unknown>) => async (req: any, res: any) => {
  try { res.json(await fn(req)); } catch (err: any) { res.status(err instanceof OnboardingAccessError ? 403 : 400).json({ error: err.message }); }
};
onboardingRouter.get("/", handler((req) => getOnboardingState(req.actor.businessId, req.actor.role)));
onboardingRouter.post("/advance", handler((req) => advanceOnboarding(req.actor.businessId, req.actor.role)));
onboardingRouter.post("/skip", handler((req) => skipOnboardingStep(req.actor.businessId, req.actor.role)));
onboardingRouter.get("/review", handler((req) => getOnboardingReview(req.actor.businessId, req.actor.role)));
onboardingRouter.post("/complete", handler((req) => completeOnboarding(req.actor.businessId, req.actor.role)));
onboardingRouter.post("/service", handler((req) => createOnboardingService(req.actor.businessId, req.actor.role, req.body)));
onboardingRouter.post("/business-hours", handler((req) => saveOnboardingBusinessHours(req.actor.businessId, req.actor.userId, req.actor.role, req.body.hours)));
