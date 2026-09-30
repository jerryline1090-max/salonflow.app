jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { getBillingCreditBalance, rewardReferralForVerifiedPayment } from "../referralService";

function referral(status = "ATTRIBUTED") {
  return {
    id: "referral_1",
    referrerBusinessId: "business_referrer",
    referredBusinessId: "business_referred",
    status,
    referrerBusiness: { subscription: { planCode: "GROWTH" } },
  };
}

describe("referral commercial-credit rewards", () => {
  beforeEach(() => {
    (prisma.referral.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.billingCreditEntry.create as jest.Mock).mockResolvedValue({ id: "credit_1" });
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
  });

  it("credits the referrer's current plan price exactly once after verified payment", async () => {
    (prisma.referral.findUnique as jest.Mock).mockResolvedValue(referral());
    await expect(rewardReferralForVerifiedPayment("business_referred", prisma)).resolves.toEqual({ rewarded: true, amount: 1_500_000 });
    expect(prisma.billingCreditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: "business_referrer", amount: 1_500_000, direction: "CREDIT", reason: "REFERRAL_REWARD", referralId: "referral_1" }) });
    expect(prisma.referral.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "referral_1", status: "ATTRIBUTED" } }));
  });

  it("does not reward an already rewarded attribution or duplicate transactional claim", async () => {
    (prisma.referral.findUnique as jest.Mock).mockResolvedValue(referral("REWARDED"));
    await expect(rewardReferralForVerifiedPayment("business_referred", prisma)).resolves.toEqual({ rewarded: false });
    expect(prisma.billingCreditEntry.create).not.toHaveBeenCalled();

    (prisma.referral.findUnique as jest.Mock).mockResolvedValue(referral());
    (prisma.referral.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(rewardReferralForVerifiedPayment("business_referred", prisma)).resolves.toEqual({ rewarded: false });
    expect(prisma.billingCreditEntry.create).not.toHaveBeenCalled();
  });

  it("derives a credit balance from immutable credit and debit entries", async () => {
    (prisma.billingCreditEntry.findMany as jest.Mock).mockResolvedValue([
      { amount: 1_000_000, direction: "CREDIT" },
      { amount: 250_000, direction: "DEBIT" },
    ]);
    await expect(getBillingCreditBalance("business_referrer")).resolves.toBe(750_000);
    expect(prisma.billingCreditEntry.findMany).toHaveBeenCalledWith({ where: { businessId: "business_referrer" }, select: { amount: true, direction: true } });
  });
});
