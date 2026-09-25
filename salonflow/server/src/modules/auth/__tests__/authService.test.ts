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
});

describe("registerBusiness", () => {
  it("rejects registration when the email is already taken", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "existing_user" });

    await expect(
      registerBusiness({ businessName: "Big Kitchen", ownerName: "Amaka", email: "amaka@test.com", password: "pw" })
    ).rejects.toThrow(/already exists/i);

    expect(prisma.business.create).not.toHaveBeenCalled();
  });

  it("creates exactly one business with exactly one OWNER user and returns a token", async () => {
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

    expect(signToken).toHaveBeenCalledWith({ sub: "user_1", businessId: "biz_1", role: "OWNER" });
    expect(result.token).toBe("signed.jwt.token");
    expect(result.user).toBe(owner);
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
