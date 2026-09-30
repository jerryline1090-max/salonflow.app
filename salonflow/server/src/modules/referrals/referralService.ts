import { BillingCreditDirection, BillingCreditReason, ReferralStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../../lib/prisma";
import { getPlanDefinition } from "../subscriptions/planConfig";

type ReferralPrisma = Pick<typeof prisma, "business" | "referral" | "billingCreditEntry" | "auditLog">;

export class InvalidReferralCodeError extends Error {
  constructor() {
    super("That referral code is not valid");
    this.name = "InvalidReferralCodeError";
  }
}

export function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase();
}

function newReferralCode() {
  // Random, compact and opaque: a business id is never exposed in a share link.
  return `SF${randomBytes(5).toString("hex").toUpperCase()}`;
}

export async function getOrCreateReferralCode(businessId: string, db: ReferralPrisma = prisma) {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { referralCode: true } });
  if (!business) throw new Error("Business not found");
  if (business.referralCode) return business.referralCode;

  // A collision is extraordinarily unlikely, but the unique index remains the
  // authority and this bounded retry avoids leaking implementation detail.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newReferralCode();
    try {
      const updated = await db.business.update({
        where: { id: businessId },
        data: { referralCode: code },
        select: { referralCode: true },
      });
      return updated.referralCode!;
    } catch (error: any) {
      if (error?.code !== "P2002" || attempt === 4) throw error;
    }
  }
  throw new Error("Unable to create referral code");
}

export async function createReferralAttribution(input: {
  db: ReferralPrisma;
  referredBusinessId: string;
  referralCode?: string;
}) {
  const rawCode = input.referralCode?.trim();
  if (!rawCode) return null;
  const referralCode = normalizeReferralCode(rawCode);
  const referrer = await input.db.business.findUnique({ where: { referralCode }, select: { id: true } });
  if (!referrer || referrer.id === input.referredBusinessId) throw new InvalidReferralCodeError();
  return input.db.referral.create({
    data: { referrerBusinessId: referrer.id, referredBusinessId: input.referredBusinessId, referralCode },
  });
}

/**
 * Rewards exactly once, inside the verified-payment transaction. The receiver's
 * current plan is priced at reward time and the immutable ledger is the balance
 * source of truth.
 */
export async function rewardReferralForVerifiedPayment(referredBusinessId: string, db: ReferralPrisma) {
  const referral = await db.referral.findUnique({
    where: { referredBusinessId },
    include: { referrerBusiness: { select: { subscription: { select: { planCode: true } } } } },
  });
  if (!referral || referral.status !== ReferralStatus.ATTRIBUTED) return { rewarded: false as const };
  const planCode = referral.referrerBusiness.subscription?.planCode;
  if (!planCode) return { rewarded: false as const };

  // The status condition prevents a repeated provider event or concurrent
  // worker from creating a second commercial credit.
  const marked = await db.referral.updateMany({
    where: { id: referral.id, status: ReferralStatus.ATTRIBUTED },
    data: { status: ReferralStatus.REWARDED, rewardedAt: new Date() },
  });
  if (marked.count !== 1) return { rewarded: false as const };

  const amount = getPlanDefinition(planCode).monthlyPriceMinor;
  await db.billingCreditEntry.create({
    data: {
      businessId: referral.referrerBusinessId,
      amount,
      direction: BillingCreditDirection.CREDIT,
      reason: BillingCreditReason.REFERRAL_REWARD,
      referralId: referral.id,
    },
  });
  await db.auditLog.create({
    data: {
      businessId: referral.referrerBusinessId,
      actorType: "SYSTEM",
      resource: "billing",
      resourceId: referral.id,
      action: "referral_credit_awarded",
      newValue: JSON.stringify({ amount, planCode }),
    },
  });
  return { rewarded: true as const, amount };
}

export async function getBillingCreditBalance(businessId: string, db: ReferralPrisma = prisma) {
  const entries = await db.billingCreditEntry.findMany({ where: { businessId }, select: { amount: true, direction: true } });
  return entries.reduce((total, entry) => total + (entry.direction === BillingCreditDirection.CREDIT ? entry.amount : -entry.amount), 0);
}

export async function getReferralSummary(businessId: string) {
  const referralCode = await getOrCreateReferralCode(businessId);
  const [referrals, creditBalance, credits] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerBusinessId: businessId },
      select: { id: true, status: true, referralCode: true, createdAt: true, rewardedAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getBillingCreditBalance(businessId),
    prisma.billingCreditEntry.findMany({
      where: { businessId },
      select: { id: true, amount: true, direction: true, reason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return {
    referralCode,
    referralLink: `/register?referralCode=${encodeURIComponent(referralCode)}`,
    counts: {
      attributed: referrals.filter((referral) => referral.status === ReferralStatus.ATTRIBUTED).length,
      rewarded: referrals.filter((referral) => referral.status === ReferralStatus.REWARDED).length,
    },
    creditBalance,
    referrals,
    credits,
  };
}
