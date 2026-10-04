jest.mock("../../../lib/prisma");
jest.mock("../../referrals/referralService", () => ({ rewardReferralForVerifiedPayment: jest.fn() }));
jest.mock("../paystack/paystackProviderFactory", () => ({ createPaystackProvider: jest.fn() }));

import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { processVerifiedPaystackEvent } from "../billingService";
import { BillingProviderError, NormalizedBillingEvent } from "../billingProvider";
import { rewardReferralForVerifiedPayment } from "../../referrals/referralService";
import { createPaystackProvider } from "../paystack/paystackProviderFactory";
import { webhooksRouter } from "../../../routes/webhooks.routes";

const mock = (fn: unknown) => fn as jest.Mock;
const fakeToken = "FAKE_TOKEN_SAFETY_REGRESSION_NEVER_LOG";
const incoming: NormalizedBillingEvent = {
  provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:fixture",
  providerReference: "sf_fixture", providerSubscriptionId: "SUB_A", amount: 1000000, currency: "NGN",
};
let subscription: any, correlated: any, billingEvent: any, checkout: any;
let invoices: any[], audits: any[], rewards: string[], logs: jest.SpyInstance[];
let inTransaction: boolean;
const originalEnvironment = process.env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  logs = ["error", "warn", "log", "info", "debug"].map(method => jest.spyOn(console, method as "error").mockImplementation(() => {}));
  subscription = { id: "sub_fixture", businessId: "biz_fixture", provider: "PAYSTACK", planCode: "STARTER",
    status: "PAST_DUE", providerSubscriptionId: null, providerEmailToken: null, providerCustomerId: "CUS_fixture",
    providerPlanCode: "PLN_fixture", currentPeriodEndsAt: null, cancelAtPeriodEnd: false };
  correlated = { ...subscription };
  checkout = { id: "checkout_fixture", businessId: subscription.businessId, subscriptionId: subscription.id,
    status: "INITIALIZED", amount: 1000000, currency: "NGN", planCode: "STARTER", providerPlanCode: "PLN_fixture" };
  billingEvent = null; invoices = []; audits = []; rewards = []; inTransaction = false;
  mock(prisma.billingCheckout.findUnique).mockImplementation(async () => ({ ...checkout, subscription: { ...correlated } }));
  mock(prisma.subscription.findUnique).mockImplementation(async ({ where }) => {
    expect(inTransaction).toBe(true);
    expect(where).toEqual({ id: "sub_fixture", businessId: "biz_fixture" });
    return { ...subscription };
  });
  mock(prisma.billingEvent.create).mockImplementation(async ({ data }) => {
    if (billingEvent) throw Object.assign(new Error("duplicate fixture event"), { code: "P2002" });
    billingEvent = { id: "event_fixture", ...data };
    return { ...billingEvent };
  });
  mock(prisma.billingEvent.findUnique).mockImplementation(async () => ({ ...billingEvent }));
  mock(prisma.billingEvent.updateMany).mockImplementation(async ({ where, data }) => {
    const statusMatches = typeof where.status === "string" ? billingEvent.status === where.status : where.status.in.includes(billingEvent.status);
    if (!statusMatches || where.processingToken && where.processingToken !== billingEvent.processingToken) return { count: 0 };
    Object.assign(billingEvent, data);
    return { count: 1 };
  });
  mock(prisma.subscription.update).mockImplementation(async ({ data }) => { Object.assign(subscription, data); return { ...subscription }; });
  mock(prisma.billingInvoice.upsert).mockImplementation(async ({ create }) => { invoices.push(create); return create; });
  mock(prisma.billingCheckout.update).mockImplementation(async ({ data }) => { Object.assign(checkout, data); return checkout; });
  mock(prisma.auditLog.create).mockImplementation(async ({ data }) => { audits.push(data); return data; });
  mock(rewardReferralForVerifiedPayment).mockImplementation(async businessId => { rewards.push(businessId); });
  mock(prisma.$transaction).mockImplementation(async (run, options) => {
    expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const saved = structuredClone({ subscription, checkout, billingEvent, invoices, audits, rewards });
    inTransaction = true;
    try { return await run(prisma); }
    catch (error) { ({ subscription, checkout, billingEvent, invoices, audits, rewards } = saved); throw error; }
    finally { inTransaction = false; }
  });
});
afterEach(() => {
  logs.forEach(log => log.mockRestore());
  if (originalEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnvironment;
});

function expectNoBillingEffects() {
  expect(prisma.subscription.update).not.toHaveBeenCalled();
  expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
  expect(rewardReferralForVerifiedPayment).not.toHaveBeenCalled();
  expect(prisma.billingCheckout.update).not.toHaveBeenCalled();
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
  expect(invoices).toEqual([]); expect(rewards).toEqual([]); expect(audits).toEqual([]);
  expect(checkout.status).toBe("INITIALIZED");
}

describe("webhook transactional provider identity fence", () => {
  it.each(["subscription.create", "charge.success", "invoice.payment_failed", "subscription.not_renew", "subscription.disable"])(
    "%s cannot overwrite A with B when reconciliation attaches A after the early check", async eventType => {
      const transaction = mock(prisma.$transaction).getMockImplementation()!;
      mock(prisma.$transaction).mockImplementation(async (run, options) => {
        // The checkout snapshot was null. Reconciliation commits before the
        // webhook's in-transaction re-read, after its early conflict check.
        subscription.providerSubscriptionId = "SUB_A";
        subscription.providerEmailToken = fakeToken;
        return transaction(run, options);
      });
      const event = { ...incoming, eventType, providerEventId: `${eventType}:fixture`, providerSubscriptionId: "SUB_B" };
      await expect(processVerifiedPaystackEvent(event)).resolves.toMatchObject({ handled: false, retryable: false, reason: "provider_identity_conflict" });
      expect(subscription).toMatchObject({ providerSubscriptionId: "SUB_A", providerEmailToken: fakeToken, status: "PAST_DUE" });
      expectNoBillingEffects();
      expect(billingEvent).toMatchObject({ id: "event_fixture", status: "REJECTED", failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT", failureStage: "provider_identity_conflict" });
      await expect(processVerifiedPaystackEvent(event)).resolves.toMatchObject({ duplicate: true, reason: "rejected" });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expectNoBillingEffects();
    },
  );

  it.each([null, "SUB_A"])("initial snapshot %s + current A + incoming A processes/replays once", async earlyIdentity => {
    correlated.providerSubscriptionId = earlyIdentity;
    subscription.providerSubscriptionId = "SUB_A";
    await expect(processVerifiedPaystackEvent(incoming)).resolves.toMatchObject({ handled: true, duplicate: false });
    await expect(processVerifiedPaystackEvent(incoming)).resolves.toMatchObject({ handled: true, duplicate: true });
    expect(subscription).toMatchObject({ providerSubscriptionId: "SUB_A", status: "ACTIVE" });
    expect(invoices).toHaveLength(1); expect(rewards).toEqual(["biz_fixture"]); expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "subscription_activated", businessId: "biz_fixture" });
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    expect(prisma.billingCheckout.update).toHaveBeenCalledTimes(1);
    expect(checkout.status).toBe("COMPLETED"); expect(billingEvent.status).toBe("PROCESSED");
  });

  it("existing A + incoming B remains an early permanent conflict with no effects", async () => {
    correlated.providerSubscriptionId = subscription.providerSubscriptionId = "SUB_A";
    await expect(processVerifiedPaystackEvent({ ...incoming, providerSubscriptionId: "SUB_B" })).resolves.toMatchObject({ reason: "provider_identity_conflict" });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expectNoBillingEffects();
    expect(subscription.providerSubscriptionId).toBe("SUB_A");
    expect(billingEvent.status).toBe("REJECTED");
  });

  it("attaches an incoming verified identity when current identity is still null", async () => {
    await expect(processVerifiedPaystackEvent(incoming)).resolves.toMatchObject({ handled: true });
    expect(subscription.providerSubscriptionId).toBe("SUB_A");
  });

  it("an initial charge without subscription identity preserves freshly reconciled credentials and period", async () => {
    const period = new Date("2026-11-01T00:00:00Z");
    Object.assign(subscription, { providerSubscriptionId: "SUB_A", providerEmailToken: fakeToken, currentPeriodEndsAt: period });
    await processVerifiedPaystackEvent({ ...incoming, providerSubscriptionId: undefined });
    expect(subscription).toMatchObject({ providerSubscriptionId: "SUB_A", providerEmailToken: fakeToken, currentPeriodEndsAt: period });
    expect(JSON.stringify(audits)).not.toContain(fakeToken);
  });

  it("rejects a changed tenant during the transaction without billing effects", async () => {
    subscription.businessId = "another_business";
    await expect(processVerifiedPaystackEvent(incoming)).resolves.toMatchObject({ reason: "correlation" });
    expectNoBillingEffects(); expect(subscription.businessId).toBe("another_business");
    expect(billingEvent).toMatchObject({ status: "REJECTED", failureCode: "CORRELATION_FAILED" });
  });

  it("a post-read serialization conflict rolls back all effects and retries through the same event row", async () => {
    const regularTransaction = mock(prisma.$transaction).getMockImplementation()!;
    mock(prisma.$transaction).mockImplementationOnce((run, options) => regularTransaction(async (tx: typeof prisma) => {
      await run(tx);
      // Model PostgreSQL rejecting the losing Serializable transaction.
      throw new Prisma.PrismaClientKnownRequestError("mock serialization conflict", { code: "P2034", clientVersion: "5.22.0" });
    }, options));
    await expect(processVerifiedPaystackEvent({ ...incoming, providerSubscriptionId: "SUB_B" })).resolves.toMatchObject({ retryable: true });
    expect(subscription.providerSubscriptionId).toBeNull();
    expect(invoices).toEqual([]); expect(rewards).toEqual([]); expect(audits).toEqual([]);
    expect(checkout.status).toBe("INITIALIZED");
    expect(billingEvent).toMatchObject({ id: "event_fixture", status: "FAILED", failureCode: "DATABASE_UNAVAILABLE" });
    // The competing transaction won. Retry sees its persisted identity.
    subscription.providerSubscriptionId = "SUB_A";
    await expect(processVerifiedPaystackEvent({ ...incoming, providerSubscriptionId: "SUB_B" })).resolves.toMatchObject({ reason: "provider_identity_conflict" });
    expect(subscription.providerSubscriptionId).toBe("SUB_A");
    expect(invoices).toEqual([]); expect(rewards).toEqual([]); expect(audits).toEqual([]);
    expect(billingEvent).toMatchObject({ id: "event_fixture", status: "REJECTED", failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT" });
  });
});

function expectSecretFree(result: unknown) {
  const output = JSON.stringify([logs.map(log => log.mock.calls), result, billingEvent, audits]);
  expect(output).not.toContain(fakeToken);
  expect(output).not.toMatch(/providerEmailToken|Authorization|email_token|raw_request|raw_response/);
}

describe.each(["development", "production"])("sanitized webhook diagnostics in %s", environment => {
  beforeEach(() => { process.env.NODE_ENV = environment; });
  it.each(["message", "stack", "nested", "name"])("does not log token-bearing exception %s", async location => {
    const error: any = new Error(location === "message" ? fakeToken : "non-sensitive fixture failure");
    if (location === "stack") error.stack = `Error: ${fakeToken}\n at mocked invoice`;
    if (location === "name") error.name = fakeToken;
    if (location === "nested") {
      error.response = { data: { email_token: fakeToken }, headers: { Authorization: fakeToken }, raw_response: fakeToken };
      error.request = { providerEmailToken: fakeToken, raw_request: fakeToken };
      error.cause = new Error(fakeToken);
    }
    mock(prisma.billingInvoice.upsert).mockRejectedValueOnce(error);
    const result = await processVerifiedPaystackEvent(incoming);
    expect(result).toMatchObject({ retryable: true });
    expectSecretFree(result);
    expect(console.error).toHaveBeenCalledWith("[billing] verified Paystack event processing failed", expect.objectContaining({
      eventType: "charge.success", stage: "invoice_upsert", failureCode: "PROCESSING_FAILED", name: location === "name" ? "UnknownError" : "Error",
    }));
  });

  it("retains safe provider category/status but never provider messages or bodies", async () => {
    const error = new BillingProviderError("TIMEOUT", fakeToken, 504, fakeToken);
    mock(prisma.billingInvoice.upsert).mockRejectedValueOnce(error);
    const result = await processVerifiedPaystackEvent(incoming);
    expectSecretFree(result);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "TIMEOUT", providerStatus: 504, name: "BillingProviderError", stage: "invoice_upsert" }));
  });

  it("does not trust malformed provider metadata at runtime", async () => {
    const error = new BillingProviderError(fakeToken as any, fakeToken, fakeToken as any);
    mock(prisma.billingInvoice.upsert).mockRejectedValueOnce(error);
    expectSecretFree(await processVerifiedPaystackEvent(incoming));
    expect(mock(console.error).mock.calls[0][1]).not.toHaveProperty("providerStatus");
    expect(mock(console.error).mock.calls[0][1]).not.toHaveProperty("kind");
  });

  it("also sanitizes claim failures", async () => {
    mock(prisma.billingEvent.create).mockRejectedValueOnce(Object.assign(new Error(fakeToken), { name: fakeToken }));
    const result = await processVerifiedPaystackEvent(incoming);
    expect(result).toMatchObject({ retryable: true, reason: "claim" });
    expectSecretFree(result);
  });

  it("also sanitizes terminal-outcome persistence failures", async () => {
    correlated.providerSubscriptionId = "SUB_B";
    mock(prisma.billingEvent.updateMany).mockRejectedValueOnce(Object.assign(new Error(fakeToken), { name: fakeToken }));
    const result = await processVerifiedPaystackEvent(incoming);
    expect(result).toMatchObject({ retryable: true });
    expectSecretFree(result);
    expect(console.error).toHaveBeenCalledWith("[billing] terminal webhook outcome could not be persisted", expect.objectContaining({ stage: "provider_identity_conflict" }));
  });

  it("returns the existing sanitized HTTP 503 with the real processor behind the route", async () => {
    mock(createPaystackProvider).mockReturnValue({ verifyWebhookSignature: () => true, normalizeWebhookEvent: () => incoming });
    mock(prisma.billingInvoice.upsert).mockRejectedValueOnce(new BillingProviderError("UNAVAILABLE", fakeToken, 502, fakeToken));
    const app = express();
    app.use("/api/webhooks", express.json({ verify: (req: any, _res, body) => { req.rawBody = body; } }), webhooksRouter);
    const response = await request(app).post("/api/webhooks/paystack").set("x-paystack-signature", "mock-only").send({ event: "charge.success" });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Webhook processing is temporarily unavailable" });
    expectSecretFree(response.body);
  });
});
