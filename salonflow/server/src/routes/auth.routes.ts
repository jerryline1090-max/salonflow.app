import { Router } from "express";
import { registerBusiness, login, createTeamMember, InvalidCredentialsError, AccountInactiveError } from "../modules/auth/authService";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/authorize";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { rethrowIfDatabaseUnavailable } from "../middleware/errorHandler";
import { summarizeSubscription } from "../modules/subscriptions/subscriptionService";
import { requireBusinessAccess } from "../middleware/requireBusinessAccess";

export const authRouter = Router();

// Public — this is the only way a Business + its OWNER account come into existence.
authRouter.post("/register", asyncHandler(async (req, res) => {
  try {
    const { businessName, ownerName, email, password, phone, referralCode } = req.body;
    if (!businessName || !ownerName || !email || !password) {
      return res.status(400).json({ error: "businessName, ownerName, email, and password are required" });
    }
    const { business, user, token } = await registerBusiness({ businessName, ownerName, email, password, phone, referralCode });
    res.status(201).json({ token, business, user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: business.id } });
  } catch (err: any) {
    rethrowIfDatabaseUnavailable(err);
    res.status(400).json({ error: err.message });
  }
}));

// Public.
authRouter.post("/login", asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await login({ email, password });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId } });
  } catch (err: any) {
    if (err instanceof InvalidCredentialsError || err instanceof AccountInactiveError) {
      return res.status(401).json({ error: err.message });
    }
    // Never leak Prisma connection strings, database hosts, stack traces, or
    // other infrastructure detail into the sign-in form. The server log keeps
    // the diagnostic detail; the browser gets an actionable, safe message.
    console.error("Login failed", err);
    res.status(503).json({ error: "We couldn't connect to SalonFlow right now. Please try again shortly." });
  }
}));

// Everything below requires a valid token.
authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.actor!.userId, businessId: req.actor!.businessId },
    select: {
      name: true,
      email: true,
      business: {
        select: {
          onboardingStatus: true,
          onboardingStep: true,
          subscription: true,
        },
      },
    },
  });
  if (!user) return res.status(401).json({ error: "Invalid or expired token" });
  res.json({
    id: req.actor!.userId,
    name: user.name,
    email: user.email,
    role: req.actor!.role,
    businessId: req.actor!.businessId,
    onboarding: req.actor!.role === "OWNER"
      ? { onboardingStatus: user.business.onboardingStatus, onboardingStep: user.business.onboardingStep }
      : undefined,
    subscription: user.business.subscription ? summarizeSubscription(user.business.subscription) : undefined,
  });
}));

// /auth/me stays recovery-safe, while authenticated team operations remain
// operational business access and must not bypass the central commercial gate.
authRouter.use("/team", authenticate, requireBusinessAccess);

// Section 28: viewing the team is a lighter bar than creating an account —
// "staff:view" (which MANAGER has by default, unlike "staff:create").
authRouter.get("/team", requirePermission("staff", "view"), asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    where: { businessId: req.actor!.businessId },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
}));

// Section 28: only an OWNER may create team accounts and assign their role
// (MANAGER default permissions don't include "staff:create" — see core/permissions.ts —
// so this 403s for anyone but an OWNER unless the business explicitly overrides it).
authRouter.post("/team", requirePermission("staff", "create"), asyncHandler(async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (role === "OWNER") {
      return res.status(400).json({ error: "Cannot create additional OWNER accounts through this endpoint" });
    }
    const user = await createTeamMember({
      businessId: req.actor!.businessId!,
      name,
      email,
      password,
      role,
      actorUserId: req.actor!.userId,
    });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err: any) {
    rethrowIfDatabaseUnavailable(err);
    res.status(400).json({ error: err.message });
  }
}));
