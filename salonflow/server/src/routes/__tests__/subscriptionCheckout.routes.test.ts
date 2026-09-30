jest.mock("../../modules/billing/billingService", () => ({ initializeBusinessCheckout: jest.fn() }));
jest.mock("../../modules/billing/paystack/paystackProviderFactory", () => ({ createPaystackProvider: jest.fn(() => ({ getPlanCode: jest.fn() })) }));
jest.mock("../../modules/subscriptions/subscriptionService", () => ({ getBusinessSubscription: jest.fn(), resolveBusinessAccess: jest.fn(), summarizeSubscription: jest.fn() }));

import express from "express";
import request from "supertest";
import { signToken } from "../../core/auth";
import { errorHandler } from "../../middleware/errorHandler";
import { initializeBusinessCheckout } from "../../modules/billing/billingService";
import { subscriptionRouter } from "../subscription.routes";

function app() { const instance = express(); instance.use(express.json()); instance.use("/api/subscription", require("../../middleware/authenticate").authenticate, subscriptionRouter); instance.use(errorHandler); return instance; }

describe("POST /api/subscription/checkout", () => {
  const owner = signToken({ sub: "owner_1", businessId: "business_1", role: "OWNER" });
  const manager = signToken({ sub: "manager_1", businessId: "business_1", role: "MANAGER" });

  beforeEach(() => jest.clearAllMocks());

  it("allows an OWNER to start server-authoritative checkout", async () => {
    (initializeBusinessCheckout as jest.Mock).mockResolvedValue({ authorizationUrl: "https://checkout.test", accessCode: "access", reference: "sf_1" });
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${owner}`).send({ planCode: "GROWTH", amount: 1, providerPlanCode: "browser-value", businessId: "other" });
    expect(response.status).toBe(201);
    expect(initializeBusinessCheckout).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business_1", actorUserId: "owner_1", planCode: "GROWTH" }));
    expect(initializeBusinessCheckout).not.toHaveBeenCalledWith(expect.objectContaining({ amount: expect.anything() }));
  });

  it("rejects non-OWNER users before checkout initialization", async () => {
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${manager}`).send({ planCode: "STARTER" });
    expect(response.status).toBe(403);
    expect(initializeBusinessCheckout).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan without calling a provider", async () => {
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${owner}`).send({ planCode: "FREE" });
    expect(response.status).toBe(400);
    expect(initializeBusinessCheckout).not.toHaveBeenCalled();
  });
});
