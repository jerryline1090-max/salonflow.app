jest.mock("../../modules/billing/billingService", () => {
  class BillingCorrelationError extends Error {}
  return { BillingCorrelationError, initializeBusinessCheckout: jest.fn(), getBillingHistory: jest.fn(), scheduleCancellation: jest.fn(), undoScheduledCancellation: jest.fn() };
});
jest.mock("../../modules/billing/paystack/paystackProviderFactory", () => ({ ...jest.requireActual("../../modules/billing/paystack/paystackProviderFactory"), createPaystackProvider: jest.fn(() => ({ getPlanCode: jest.fn() })) }));
jest.mock("../../modules/subscriptions/subscriptionService", () => ({ getBusinessSubscription: jest.fn(), resolveBusinessAccess: jest.fn(), summarizeSubscription: jest.fn() }));

import express from "express";
import request from "supertest";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { errorHandler } from "../../middleware/errorHandler";
import { BillingCorrelationError, getBillingHistory, initializeBusinessCheckout, undoScheduledCancellation } from "../../modules/billing/billingService";
import { BillingProviderError } from "../../modules/billing/billingProvider";
import { subscriptionRouter } from "../subscription.routes";
import { FetchPaystackHttpClient } from "../../modules/billing/paystack/paystackProviderFactory";

function app() { const instance = express(); instance.use(express.json()); instance.use("/api/subscription", require("../../middleware/authenticate").authenticate, subscriptionRouter); instance.use(errorHandler); return instance; }

describe("POST /api/subscription/checkout", () => {
  const owner = signToken({ sub: "owner_1", businessId: "business_1", role: "OWNER" });
  const manager = signToken({ sub: "manager_1", businessId: "business_1", role: "MANAGER" });
  const staff = signToken({ sub: "staff_1", businessId: "business_1", role: "STAFF" });

  beforeEach(() => jest.clearAllMocks());

  it("allows an OWNER to start server-authoritative checkout", async () => {
    (initializeBusinessCheckout as jest.Mock).mockResolvedValue({ authorizationUrl: "https://checkout.test", accessCode: "access", reference: "sf_1" });
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${owner}`).send({ planCode: "GROWTH", amount: 1, providerPlanCode: "browser-value", businessId: "other" });
    expect(response.status).toBe(201);
    expect(initializeBusinessCheckout).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business_1", actorUserId: "owner_1", planCode: "GROWTH" }));
    expect(initializeBusinessCheckout).not.toHaveBeenCalledWith(expect.objectContaining({ amount: expect.anything() }));
    const input = (initializeBusinessCheckout as jest.Mock).mock.calls[0][0];
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("pastDueEndsAt");
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

  it("returns a factual conflict message when an existing provider subscription blocks a new recurring checkout", async () => {
    (initializeBusinessCheckout as jest.Mock).mockRejectedValue(new BillingCorrelationError("Existing recurring billing requires reconciliation before a replacement checkout can be started"));
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${owner}`).send({ planCode: "STARTER" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Existing recurring billing requires reconciliation before a replacement checkout can be started" });
  });

  it("maps a provider rejection to a safe gateway response without provider payloads", async () => {
    (initializeBusinessCheckout as jest.Mock).mockRejectedValue(new BillingProviderError("REJECTED", "Paystack rejected the checkout request", 422, "Invalid configured test plan"));
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${owner}`).send({ planCode: "STARTER" });
    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Paystack could not initialize this checkout. Verify the configured plan and try again.",
      code: "BILLING_PROVIDER_REJECTED",
      providerStatus: 422,
      providerMessage: "Invalid configured test plan",
    });
  });

  it.each(["PAST_DUE", "SUSPENDED"])("allows the OWNER to initialize %s recovery without changing status", async () => {
    (initializeBusinessCheckout as jest.Mock).mockResolvedValue({ authorizationUrl: "https://checkout.test", accessCode: "access", reference: "sf_recovery" });
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${owner}`).send({ planCode: "STARTER", amount: 1, providerPlanCode: "browser", providerSubscriptionId: "other" });
    expect(response.status).toBe(201);
    expect(initializeBusinessCheckout).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business_1", planCode: "STARTER" }));
    expect(initializeBusinessCheckout).not.toHaveBeenCalledWith(expect.objectContaining({ amount: expect.anything() }));
  });

  it.each([manager, staff])("denies non-OWNER recovery checkout", async (token) => {
    const response = await request(app()).post("/api/subscription/checkout").set("Authorization", `Bearer ${token}`).send({ planCode: "STARTER" });
    expect(response.status).toBe(403);
  });
});

describe("POST /api/subscription/cancel/undo safe failures", () => {
  const owner = signToken({ sub: "owner_1", businessId: "business_1", role: "OWNER" });
  let log: jest.SpyInstance;
  beforeEach(() => { jest.clearAllMocks(); log = jest.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());
  it("maps the observed Paystack 400 body through the real HTTP boundary to sanitized 409", async () => {
    const savedFetch = global.fetch;
    const message = "Subscription has been cancelled, and cannot be reactivated";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: jest.fn().mockResolvedValue({ status: false, message }) }) as any;
    try {
      const failure = await new FetchPaystackHttpClient().post("/subscription/enable", { code: "SUB_fixture", token: "fake-private-token" }, { authorization: "Bearer fake-private-key", timeoutMs: 1000 }).catch(error => error);
      expect(failure).toMatchObject({ kind: "REJECTED", rejectionCategory: "STATE_CONFLICT", providerStatus: 400, providerResponseStatus: false });
      (undoScheduledCancellation as jest.Mock).mockRejectedValueOnce(failure);
      const r = await request(app()).post("/api/subscription/cancel/undo").set("Authorization", `Bearer ${owner}`);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("BILLING_PROVIDER_STATE_CONFLICT");
      expect(JSON.stringify([r.body, log.mock.calls])).not.toContain(message);
      expect(JSON.stringify([r.body, log.mock.calls])).not.toContain("fake-private");
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally { global.fetch = savedFetch; }
  });
  it.each([
    ["REJECTED", undefined, 502, "BILLING_PROVIDER_REJECTED"],
    ["REJECTED", "STATE_CONFLICT", 409, "BILLING_PROVIDER_STATE_CONFLICT"],
    ["REJECTED", "CREDENTIAL_INVALID", 502, "BILLING_RECONCILIATION_REQUIRED"],
    ["TIMEOUT", undefined, 504, "BILLING_PROVIDER_TIMEOUT"],
    ["UNAVAILABLE", undefined, 502, "BILLING_PROVIDER_UNAVAILABLE"],
    ["MALFORMED_RESPONSE", undefined, 502, "BILLING_PROVIDER_MALFORMED_RESPONSE"],
    ["CONFIGURATION", undefined, 503, "BILLING_PROVIDER_CONFIGURATION"],
  ])("maps %s/%s to %s without exposing provider diagnostics", async (kind, category, status, code) => {
    (undoScheduledCancellation as jest.Mock).mockRejectedValueOnce(new BillingProviderError(kind as any, "private-internal-error", 400, "private-provider-message", false, category as any));
    const r = await request(app()).post("/api/subscription/cancel/undo").set("Authorization", `Bearer ${owner}`).send({ token: "browser-token", providerSubscriptionId: "other" });
    expect(r.status).toBe(status);expect(r.body.code).toBe(code);
    expect(undoScheduledCancellation).toHaveBeenCalledWith("business_1", "owner_1", expect.any(Object));
    expect(JSON.stringify([r.body, log.mock.calls])).not.toMatch(/private-|browser-token/);
    expect(r.body).not.toHaveProperty("providerMessage");expect(r.body).not.toHaveProperty("providerStatus");
  });
  it("preserves safe local-state conflict semantics", async () => {
    (undoScheduledCancellation as jest.Mock).mockRejectedValueOnce(new BillingCorrelationError("private detail"));
    const r = await request(app()).post("/api/subscription/cancel/undo").set("Authorization", `Bearer ${owner}`);
    expect(r.status).toBe(409);expect(JSON.stringify(r.body)).not.toContain("private detail");
  });
  it("keeps actual unexpected application failures as sanitized 500", async () => {
    (undoScheduledCancellation as jest.Mock).mockRejectedValueOnce(new Error("private failure"));
    const r = await request(app()).post("/api/subscription/cancel/undo").set("Authorization", `Bearer ${owner}`);
    expect(r.status).toBe(500);expect(r.body).toEqual({ error: "Internal server error" });
  });
  it.each(["MANAGER", "STAFF"] as const)("still forbids %s billing actions", async role => {
    const token = signToken({ sub: "not-owner", businessId: "business_1", role });
    const r = await request(app()).post("/api/subscription/cancel/undo").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(403);expect(undoScheduledCancellation).not.toHaveBeenCalled();
  });
});

describe("GET /api/subscription/history", () => {
  const owner = signToken({ sub: "owner_1", businessId: "business_1", role: "OWNER" });
  const manager = signToken({ sub: "manager_1", businessId: "business_1", role: "MANAGER" });
  const staff = signToken({ sub: "staff_1", businessId: "business_1", role: "STAFF" });
  beforeEach(() => jest.clearAllMocks());
  it("returns only safe, server-scoped commercial invoice history to the OWNER", async () => {
    (getBillingHistory as jest.Mock).mockResolvedValue([{ id: "invoice_1", amount: 1000000, currency: "NGN", status: "PAID", paidAt: null, occurredAt: new Date() }]);
    const response = await request(app()).get("/api/subscription/history").set("Authorization", `Bearer ${owner}`);
    expect(response.status).toBe(200);
    expect(getBillingHistory).toHaveBeenCalledWith("business_1");
    expect(response.body[0]).not.toHaveProperty("providerSubscriptionId");
    expect(response.body[0]).not.toHaveProperty("providerReference");
  });
  it.each([manager, staff])("denies non-OWNER commercial billing history", async (token) => {
    const response = await request(app()).get("/api/subscription/history").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(getBillingHistory).not.toHaveBeenCalled();
  });
});
jest.mock("../../lib/prisma");
