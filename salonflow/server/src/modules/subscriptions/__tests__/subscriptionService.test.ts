jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import {
  createTrialSubscription,
  deriveSubscriptionAccessState,
  getGracePeriodEndsAt,
  getBusinessSubscription,
  summarizeSubscription,
} from "../subscriptionService";
import { getPlanDefinition } from "../planConfig";

describe("subscriptionService", () => {
  it("creates a fourteen-day STARTER trial without a paid period", () => {
    const createdAt = new Date("2026-09-30T12:00:00.000Z");
    const subscription = createTrialSubscription(createdAt);

    expect(subscription).toEqual({
      planCode: "STARTER",
      status: "TRIALING",
      trialEndsAt: new Date("2026-10-14T12:00:00.000Z"),
      graceEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
    });
    expect(getGracePeriodEndsAt(new Date("2026-10-14T12:00:00.000Z"))).toEqual(new Date("2026-10-17T12:00:00.000Z"));
  });

  it("keeps Nigerian monthly prices in integer minor units without operational limits", () => {
    expect(getPlanDefinition("STARTER")).toMatchObject({ currency: "NGN", monthlyPriceMinor: 1_000_000, entitlements: {} });
    expect(getPlanDefinition("GROWTH")).toMatchObject({ currency: "NGN", monthlyPriceMinor: 1_500_000, entitlements: {} });
    expect(getPlanDefinition("PRO")).toMatchObject({ currency: "NGN", monthlyPriceMinor: 2_500_000, entitlements: {} });
  });

  it("summarizes subscription state without provider data", () => {
    const summary = summarizeSubscription({
      id: "sub_1",
      businessId: "biz_1",
      planCode: "STARTER",
      status: "TRIALING",
      trialEndsAt: new Date("2026-10-14T00:00:00.000Z"),
      graceEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      createdAt: new Date("2026-09-30T00:00:00.000Z"),
      updatedAt: new Date("2026-09-30T00:00:00.000Z"),
    }, new Date("2026-09-30T00:00:00.000Z"));

    expect(summary).toEqual(expect.objectContaining({
      planCode: "STARTER",
      status: "TRIALING",
      accessState: "FULL_ACCESS",
      trialDaysRemaining: 14,
    }));
    expect(deriveSubscriptionAccessState("GRACE_PERIOD")).toBe("RECOVERY");
    expect(deriveSubscriptionAccessState("SUSPENDED")).toBe("SUSPENDED");
  });

  it("fetches subscriptions by their unique business owner", async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(getBusinessSubscription("biz_1")).resolves.toBeNull();
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { businessId: "biz_1" } });
  });
});
