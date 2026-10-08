jest.mock("../../lib/prisma");
jest.mock("../../modules/auth/authService");
jest.mock("../../modules/subscriptions/subscriptionService", () => ({
  getBusinessSubscription: jest.fn().mockResolvedValue({ id: "sub_1" }),
  resolveBusinessAccess: jest.fn(() => ({ allowed: true, accessState: "FULL_ACCESS" })),
  summarizeSubscription: jest.fn((subscription) => ({
    planCode: subscription.planCode,
    status: subscription.status,
    trialEndsAt: subscription.trialEndsAt,
    graceEndsAt: subscription.graceEndsAt,
    currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    accessState: "FULL_ACCESS",
    trialDaysRemaining: 14,
  })),
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authRouter } from "../auth.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { registerBusiness, login, createTeamMember, InvalidCredentialsError } from "../../modules/auth/authService";
import { errorHandler } from "../../middleware/errorHandler";
import { Prisma } from "@prisma/client";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/auth/register", () => {
  it("never serializes nested users or credentials from a broad service result", async () => {
    const owner = { id: "owner_1", name: "Ada", email: "ada@test.com", role: "OWNER", passwordHash: "fixture-hash-secret", resetToken: "fixture-reset-secret" };
    (registerBusiness as jest.Mock).mockResolvedValue({
      token: "fixture-jwt", user: owner,
      business: { id: "biz_1", name: "Test Salon", users: [owner], createdAt: "unneeded", subscription: { providerEmailToken: "fixture-provider-secret" } },
    });
    const res = await request(buildApp()).post("/api/auth/register").send({
      businessName: "Test Salon", ownerName: "Ada", email: "ada@test.com", password: "password1",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      token: "fixture-jwt", business: { id: "biz_1", name: "Test Salon" },
      user: { id: "owner_1", name: "Ada", email: "ada@test.com", role: "OWNER", businessId: "biz_1" },
    });
    for (const forbidden of ["passwordHash", "fixture-hash-secret", "resetToken", "fixture-reset-secret", "users", "providerEmailToken", "createdAt"]) {
      expect(res.text).not.toContain(forbidden);
    }
  });
  it("rejects a request missing required fields without touching the database", async () => {
    const res = await request(buildApp()).post("/api/auth/register").send({ email: "amaka@test.com" });

    expect(res.status).toBe(400);
    expect(registerBusiness).not.toHaveBeenCalled();
  });

  it("creates the business and returns a token on success", async () => {
    (registerBusiness as jest.Mock).mockResolvedValue({
      business: { id: "biz_1", name: "Big Kitchen" },
      user: { id: "user_1", name: "Amaka", email: "amaka@test.com", role: "OWNER" },
      token: "signed.jwt.token",
    });

    const res = await request(buildApp()).post("/api/auth/register").send({
      businessName: "Big Kitchen",
      ownerName: "Amaka",
      email: "amaka@test.com",
      password: "supersecret",
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe("signed.jwt.token");
    expect(res.body.user.role).toBe("OWNER");
  });
});

describe("POST /api/auth/login", () => {
  it("returns 401 with a generic message on invalid credentials", async () => {
    (login as jest.Mock).mockRejectedValue(new InvalidCredentialsError());

    const res = await request(buildApp()).post("/api/auth/login").send({ email: "x@test.com", password: "wrong" });

    expect(res.status).toBe(401);
  });

  it("returns a token on success", async () => {
    (login as jest.Mock).mockResolvedValue({
      user: { id: "user_1", name: "Amaka", email: "amaka@test.com", role: "OWNER", businessId: "biz_1", passwordHash: "fixture-login-hash" },
      token: "signed.jwt.token",
    });

    const res = await request(buildApp()).post("/api/auth/login").send({ email: "amaka@test.com", password: "correct" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("signed.jwt.token");
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain("fixture-login-hash");
  });

  it("does not expose database or internal errors to the sign-in form", async () => {
    const logError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (login as jest.Mock).mockRejectedValue(new Error("Can't reach database server at secret-host:5432"));

    const res = await request(buildApp()).post("/api/auth/login").send({ email: "amaka@test.com", password: "correct" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("We couldn't connect to SalonFlow right now. Please try again shortly.");
    expect(res.body.error).not.toContain("secret-host");
    logError.mockRestore();
  });
});

describe("GET /api/auth/team", () => {
  it("401s with no token", async () => {
    const res = await request(buildApp()).get("/api/auth/team");
    expect(res.status).toBe(401);
  });

  it("MANAGER can view the team list (view is a lighter bar than create)", async () => {
    const managerToken = signToken({ sub: "mgr_1", businessId: "biz_1", role: "MANAGER" });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/auth/team").set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect((prisma.user.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ businessId: "biz_1" });
  });
});

describe("GET /api/auth/me", () => {
  it("returns a safe business subscription summary without provider details", async () => {
    const token = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "owner_1",
      passwordHash: "fixture-me-hash",
      isActive: true,
      name: "Amaka",
      email: "amaka@test.com",
      role: "OWNER",
      businessId: "biz_1",
      business: {
        onboardingStatus: "IN_PROGRESS",
        onboardingStep: "BUSINESS_DETAILS",
        subscription: {
          planCode: "STARTER",
          status: "TRIALING",
          trialEndsAt: new Date("2026-10-14T00:00:00.000Z"),
          graceEndsAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          providerCustomerId: "must-not-leak",
        },
      },
    });

    const res = await request(buildApp()).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.subscription).toEqual(expect.objectContaining({
      planCode: "STARTER",
      status: "TRIALING",
      cancelAtPeriodEnd: false,
      accessState: "FULL_ACCESS",
    }));
    expect(res.body.subscription.providerCustomerId).toBeUndefined();
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain("fixture-me-hash");
    expect(res.body.onboarding).toEqual({ onboardingStatus: "IN_PROGRESS", onboardingStep: "BUSINESS_DETAILS" });
  });

  it("returns a safe 503 for a Prisma connectivity failure", async () => {
    const token = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
    (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "5.18.0" }));

    const res = await request(buildApp()).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
  });
});

describe("POST /api/auth/team", () => {
  const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
  const staffToken = signToken({ sub: "staff_1", businessId: "biz_1", role: "STAFF" });

  it("401s with no token", async () => {
    const res = await request(buildApp()).post("/api/auth/team").send({ name: "Mike", email: "mike@test.com", password: "pw", role: "STAFF" });
    expect(res.status).toBe(401);
  });

  it("403s for a STAFF token — only an OWNER may create team accounts by default", async () => {
    const res = await request(buildApp())
      .post("/api/auth/team")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Mike", email: "mike@test.com", password: "pw", role: "STAFF" });

    expect(res.status).toBe(403);
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  it("rejects an attempt to create another OWNER account through this endpoint", async () => {
    const res = await request(buildApp())
      .post("/api/auth/team")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Second Owner", email: "second@test.com", password: "pw", role: "OWNER" });

    expect(res.status).toBe(400);
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  it("lets an OWNER create a STAFF or MANAGER account, scoped to their own business", async () => {
    (createTeamMember as jest.Mock).mockResolvedValue({ id: "user_2", name: "Mike", email: "mike@test.com", role: "STAFF" });

    const res = await request(buildApp())
      .post("/api/auth/team")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Mike", email: "mike@test.com", password: "pw123456", role: "STAFF" });

    expect(res.status).toBe(201);
    expect(createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "biz_1", role: "STAFF", actorUserId: "owner_1" })
    );
  });
});
