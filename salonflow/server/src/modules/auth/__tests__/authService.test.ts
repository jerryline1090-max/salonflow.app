jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");
jest.mock("../../../core/auth", () => ({
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
  signToken: jest.fn(),
}));

import { prisma } from "../../../lib/prisma";
import { writeAuditLog } from "../../../core/auditLog";
import { hashPassword, verifyPassword, signToken } from "../../../core/auth";
import {
  registerBusiness,
  login,
  createTeamMember,
  InvalidCredentialsError,
  AccountInactiveError,
} from "../authService";

beforeEach(() => {
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback(prisma));
  (prisma.business.update as jest.Mock).mockResolvedValue({ referralCode: "SFNEWCODE" });
  (prisma.business.findUnique as jest.Mock).mockResolvedValue({ referralCode: null });
});

describe("registerBusiness", () => {
  it("rejects registration when the email is already taken", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "existing_user" });

    await expect(
      registerBusiness({ businessName: "Big Kitchen", ownerName: "Amaka", email: "amaka@test.com", password: "pw123456" })
    ).rejects.toThrow(/already exists/i);

    expect(prisma.business.create).not.toHaveBeenCalled();
  });

  it("creates exactly one business with exactly one OWNER and a STARTER trial subscription", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (hashPassword as jest.Mock).mockResolvedValue("hashed_pw");
    (signToken as jest.Mock).mockReturnValue("signed.jwt.token");

    const owner = { id: "user_1", name: "Amaka", email: "amaka@test.com", role: "OWNER" };
    (prisma.business.create as jest.Mock).mockResolvedValue({ id: "biz_1", name: "Big Kitchen", users: [owner] });

    const result = await registerBusiness({
      businessName: "Big Kitchen",
      ownerName: "Amaka",
      email: "amaka@test.com",
      password: "supersecret",
    });

    // The owner's role is hardcoded to OWNER in the create call — a signup
    // request body can never smuggle in a different role.
    const createArgs = (prisma.business.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.users.create.role).toBe("OWNER");
    expect(createArgs.data.users.create.passwordHash).toBe("hashed_pw");
    expect(createArgs.data.subscription.create).toEqual(expect.objectContaining({
      planCode: "STARTER",
      status: "TRIALING",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      currentPeriodEndsAt: null,
    }));
    expect(createArgs.data.subscription.create.trialEndsAt.getTime()).toBeGreaterThan(Date.now() + (13 * 24 * 60 * 60 * 1000));
    expect(createArgs.data.subscription.create.trialEndsAt.getTime()).toBeLessThanOrEqual(Date.now() + (14 * 24 * 60 * 60 * 1000) + 1000);
    expect(createArgs.data.onboardingStatus).toBe("IN_PROGRESS");
    expect(createArgs.data.onboardingStep).toBe("BUSINESS_DETAILS");
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "biz_1" },
      data: { referralCode: expect.stringMatching(/^SF[A-F0-9]{10}$/) },
    }));

    expect(signToken).toHaveBeenCalledWith({ sub: "user_1", businessId: "biz_1", role: "OWNER" });
    expect(result.token).toBe("signed.jwt.token");
    expect(result.user).toEqual({ ...owner, businessId: "biz_1" });
    expect(result.business).toEqual({ id: "biz_1", name: "Big Kitchen" });
    expect(prisma.business.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(createArgs.select).toEqual({
      id: true, name: true,
      users: { select: { id: true, name: true, email: true, role: true, businessId: true } },
    });
    expect(createArgs.include).toBeUndefined();
  });

  it("projects only public fields even if Prisma returns unexpected sensitive properties", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (hashPassword as jest.Mock).mockResolvedValue("fixture-password-hash");
    (signToken as jest.Mock).mockReturnValue("fixture-jwt");
    const owner = {
      id: "owner_1", name: "Ada", email: "ada@test.com", role: "OWNER", businessId: "biz_1",
      passwordHash: "fixture-password-hash", resetToken: "fixture-reset", permissions: [{ secret: true }],
      createdAt: new Date(), updatedAt: new Date(),
    };
    (prisma.business.create as jest.Mock).mockResolvedValue({
      id: "biz_1", name: "Test Salon", users: [owner],
      subscription: { providerEmailToken: "fixture-provider-secret" },
    });
    const result = await registerBusiness({ businessName: "Test Salon", ownerName: "Ada", email: "ada@test.com", password: "password1" });
    expect(result).toEqual({
      token: "fixture-jwt", business: { id: "biz_1", name: "Test Salon" },
      user: { id: "owner_1", name: "Ada", email: "ada@test.com", role: "OWNER", businessId: "biz_1" },
    });
    const json = JSON.stringify(result);
    for (const forbidden of ["passwordHash", "fixture-password-hash", "resetToken", "permissions", "providerEmailToken", "users", "createdAt", "updatedAt"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(owner.passwordHash).toBe("fixture-password-hash");
  });

  it("attributes a registration only through a valid server-resolved referral code", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (hashPassword as jest.Mock).mockResolvedValue("hashed_pw");
    (signToken as jest.Mock).mockReturnValue("signed.jwt.token");
    (prisma.business.create as jest.Mock).mockResolvedValue({ id: "biz_new", users: [{ id: "user_new", role: "OWNER" }] });
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ id: "biz_referrer" });
    (prisma.referral.create as jest.Mock).mockResolvedValue({ id: "referral_1" });

    await registerBusiness({ businessName: "New Salon", ownerName: "Ada", email: "ada@test.com", password: "password1", referralCode: "  sfabc123  " });

    expect(prisma.referral.create).toHaveBeenCalledWith({ data: { referrerBusinessId: "biz_referrer", referredBusinessId: "biz_new", referralCode: "SFABC123" } });
  });

  it("rejects an explicit invalid referral code without creating an attribution", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (hashPassword as jest.Mock).mockResolvedValue("hashed_pw");
    (prisma.business.create as jest.Mock).mockResolvedValue({ id: "biz_new", users: [{ id: "user_new", role: "OWNER" }] });
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(registerBusiness({ businessName: "New Salon", ownerName: "Ada", email: "ada@test.com", password: "password1", referralCode: "missing" })).rejects.toThrow(/referral code/i);
    expect(prisma.referral.create).not.toHaveBeenCalled();
  });
});

describe("login", () => {
  it("rejects an unknown email without revealing whether the account exists", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(login({ email: "nobody@test.com", password: "pw" })).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects an incorrect password", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user_1", passwordHash: "hash", isActive: true });
    (verifyPassword as jest.Mock).mockResolvedValue(false);

    await expect(login({ email: "amaka@test.com", password: "wrong" })).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects a deactivated account even with the correct password", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user_1", passwordHash: "hash", isActive: false });
    (verifyPassword as jest.Mock).mockResolvedValue(true);

    await expect(login({ email: "amaka@test.com", password: "correct" })).rejects.toThrow(AccountInactiveError);
    await expect(login({ email: "amaka@test.com", password: "correct" })).rejects.toThrow("Invalid email or password");
    expect(signToken).not.toHaveBeenCalled();
  });

  it("issues a token scoped to the user's business and role on success", async () => {
    const user = { id: "user_1", businessId: "biz_1", role: "STAFF", passwordHash: "hash", isActive: true };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    (verifyPassword as jest.Mock).mockResolvedValue(true);
    (signToken as jest.Mock).mockReturnValue("signed.jwt.token");

    const result = await login({ email: "staff@test.com", password: "correct" });

    expect(signToken).toHaveBeenCalledWith({ sub: "user_1", businessId: "biz_1", role: "STAFF" });
    expect(result.token).toBe("signed.jwt.token");
  });
});

describe("createTeamMember", () => {
  it("creates the account with whatever role the caller (owner/manager) specified, records an audit entry", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (hashPassword as jest.Mock).mockResolvedValue("hashed_pw");
    const created = { id: "user_2", name: "Mike", email: "mike@test.com", role: "STAFF" };
    (prisma.user.create as jest.Mock).mockResolvedValue(created);

    const result = await createTeamMember({
      businessId: "biz_1",
      name: "Mike",
      email: "mike@test.com",
      password: "pw123456",
      role: "STAFF",
      actorUserId: "owner_1",
    });

    expect(result).toBe(created);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "staff", action: "create_team_member", actorUserId: "owner_1" })
    );
  });

  it("rejects when the email is already in use", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });

    await expect(
      createTeamMember({
        businessId: "biz_1",
        name: "Mike",
        email: "mike@test.com",
        password: "pw123456",
        role: "STAFF",
        actorUserId: "owner_1",
      })
    ).rejects.toThrow(/already exists/i);
  });
});
