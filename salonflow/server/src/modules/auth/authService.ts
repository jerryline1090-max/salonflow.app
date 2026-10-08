import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword, signToken } from "../../core/auth";
import { writeAuditLog } from "../../core/auditLog";
import { createTrialSubscription } from "../subscriptions/subscriptionService";
import { createReferralAttribution, getOrCreateReferralCode } from "../referrals/referralService";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountInactiveError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "AccountInactiveError";
  }
}

export interface RegisterBusinessInput {
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  phone?: string;
  referralCode?: string;
}

/**
 * The only way a Business comes into existence: alongside exactly one
 * OWNER user. There is no "sign up without a business" path, and no way to
 * self-assign MANAGER/STAFF at signup — those roles are only ever granted
 * later by an existing OWNER/MANAGER (section 28).
 */
export async function registerBusiness(input: RegisterBusinessInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters");
  if (!input.businessName.trim() || !input.ownerName.trim()) throw new Error("Name and business name are required");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  const business = await prisma.$transaction(async (tx) => {
    const created = await tx.business.create({
      data: {
        name: input.businessName.trim(),
        phone: input.phone?.trim() || null,
        onboardingStatus: "IN_PROGRESS",
        onboardingStep: "BUSINESS_DETAILS",
        subscription: {
          create: createTrialSubscription(),
        },
        users: {
          create: {
            name: input.ownerName.trim(),
            email,
            passwordHash,
            role: "OWNER",
          },
        },
      },
      include: { users: true },
    });
    await createReferralAttribution({ db: tx, referredBusinessId: created.id, referralCode: input.referralCode });
    // Every newly eligible business receives an opaque, stable code as part of
    // the same registration transaction. Legacy businesses receive theirs on
    // first referral-summary access rather than being backfilled with guesses.
    await getOrCreateReferralCode(created.id, tx);
    return created;
  });

  const owner = business.users[0];
  const token = signToken({ sub: owner.id, businessId: business.id, role: owner.role });

  return { business, user: owner, token };
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new InvalidCredentialsError();
  }
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new InvalidCredentialsError();
  }
  if (!user.isActive) {
    throw new AccountInactiveError();
  }

  const token = signToken({ sub: user.id, businessId: user.businessId, role: user.role });
  return { user, token };
}

export interface CreateTeamMemberInput {
  businessId: string;
  name: string;
  email: string;
  password: string;
  role: Role; // Chosen by the OWNER/MANAGER creating the account — the
  // invitee never picks their own role (section 28, hard rule).
  actorUserId: string;
}

/** Section 28: users don't self-select a role — an owner/authorized admin assigns it. */
export async function createTeamMember(input: CreateTeamMemberInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    },
  });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "staff",
    resourceId: user.id,
    action: "create_team_member",
    newValue: { name: user.name, email: user.email, role: user.role },
  });

  return user;
}
