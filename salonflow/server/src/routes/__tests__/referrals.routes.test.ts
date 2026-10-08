jest.mock("../../modules/referrals/referralService", () => ({ getReferralSummary: jest.fn() }));

import express from "express";
import request from "supertest";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { errorHandler } from "../../middleware/errorHandler";
import { getReferralSummary } from "../../modules/referrals/referralService";
import { referralsRouter } from "../referrals.routes";

function app() {
  const instance = express();
  instance.use("/api/referrals", require("../../middleware/authenticate").authenticate, referralsRouter);
  instance.use(errorHandler);
  return instance;
}

describe("GET /api/referrals", () => {
  const owner = signToken({ sub: "owner_1", businessId: "business_1", role: "OWNER" });
  const manager = signToken({ sub: "manager_1", businessId: "business_1", role: "MANAGER" });

  beforeEach(() => jest.clearAllMocks());

  it("returns only a safe, authenticated-business referral summary to the OWNER", async () => {
    (getReferralSummary as jest.Mock).mockResolvedValue({ referralCode: "SFABC", referralLink: "/register?referralCode=SFABC", counts: { attributed: 1, rewarded: 1 }, creditBalance: 1_000_000, referrals: [{ id: "ref_1", status: "REWARDED" }], credits: [{ id: "credit_1", amount: 1_000_000, direction: "CREDIT", reason: "REFERRAL_REWARD" }] });
    const response = await request(app()).get("/api/referrals").set("Authorization", `Bearer ${owner}`);
    expect(response.status).toBe(200);
    expect(getReferralSummary).toHaveBeenCalledWith("business_1");
    expect(JSON.stringify(response.body)).not.toContain("providerSubscriptionId");
    expect(JSON.stringify(response.body)).not.toContain("Payment");
  });

  it("does not expose referral credit data to a manager", async () => {
    const response = await request(app()).get("/api/referrals").set("Authorization", `Bearer ${manager}`);
    expect(response.status).toBe(403);
    expect(getReferralSummary).not.toHaveBeenCalled();
  });
});
jest.mock("../../lib/prisma");
