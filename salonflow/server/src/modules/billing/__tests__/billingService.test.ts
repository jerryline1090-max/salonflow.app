jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { initializeBusinessCheckout, processVerifiedPaystackEvent } from "../billingService";

const subscription = { id: "sub_1", businessId: "biz_1", planCode: "GROWTH", status: "TRIALING", provider: "PAYSTACK", providerCustomerId: null, providerSubscriptionId: null, providerEmailToken: null, providerPlanCode: "PLN_GROWTH", trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: null, cancelAtPeriodEnd: false, createdAt: new Date(), updatedAt: new Date() };
const checkout = { id: "checkout_1", businessId: "biz_1", subscriptionId: "sub_1", provider: "PAYSTACK", reference: "sf_initial", planCode: "GROWTH", providerPlanCode: "PLN_GROWTH", amount: 1_500_000, currency: "NGN", status: "INITIALIZED", subscription };

function setup({ existingEvent = null as any, initialCheckout = null as any, recurringSubscription = null as any } = {}) {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  (prisma.billingEvent.findUnique as jest.Mock).mockResolvedValue(existingEvent);
  (prisma.billingCheckout.findUnique as jest.Mock).mockResolvedValue(initialCheckout);
  (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(recurringSubscription);
  (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(initialCheckout?.subscription ?? recurringSubscription);
  (prisma.billingEvent.create as jest.Mock).mockImplementation(async () => {
    if (existingEvent) {
      const error: any = new Error("Unique constraint");
      error.code = "P2002";
      throw error;
    }
    return { id: "event_1" };
  });
  (prisma.billingEvent.update as jest.Mock).mockResolvedValue({});
  (prisma.billingEvent.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.billingInvoice.upsert as jest.Mock).mockResolvedValue({});
  (prisma.subscription.update as jest.Mock).mockResolvedValue({});
  (prisma.billingCheckout.update as jest.Mock).mockResolvedValue({});
  (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
  (prisma.referral.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.referral.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.billingCreditEntry.create as jest.Mock).mockResolvedValue({});
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback(prisma));
}

describe("persistent Paystack webhook correlation", () => {
  it("persists verified subscription.create identity without activating or invoicing", async () => {
    setup({ initialCheckout: checkout });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:sub_code", providerReference: "sf_initial", providerSubscriptionId: "sub_code", providerCustomerId: "customer_code", providerEmailToken: "server-only-token", providerPlanCode: "PLN_GROWTH" })).resolves.toMatchObject({ handled: true });
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerSubscriptionId: "sub_code", providerCustomerId: "customer_code", providerEmailToken: "server-only-token", providerPlanCode: "PLN_GROWTH" }) }));
    expect((prisma.subscription.update as jest.Mock).mock.calls[0][0].data.status).toBeUndefined();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect((prisma.subscription.update as jest.Mock).mock.calls[0][0].where).toEqual({ id: "sub_1" });
  });

  it("treats an already-persisted subscription.create as a no-op", async () => {
    setup({ existingEvent: { id: "event_existing", status: "PROCESSED" } });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:sub_code", providerReference: "sf_initial" })).resolves.toMatchObject({ duplicate: true });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("does not overwrite an authoritative provider subscription when a different trusted checkout event arrives", async () => {
    const authoritative = { ...subscription, providerSubscriptionId: "sub_authoritative" };
    setup({ initialCheckout: { ...checkout, subscription: authoritative } });

    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:sub_replacement", providerReference: "sf_initial", providerSubscriptionId: "sub_replacement" })).resolves.toMatchObject({ handled: false, reason: "provider_identity_conflict" });

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT" }) }));
  });

  it("rejects a conflicting plan-based charge without invoicing, activating, or rewarding", async () => {
    const authoritative = { ...subscription, status: "PAST_DUE", providerSubscriptionId: "sub_authoritative" };
    setup({ initialCheckout: { ...checkout, subscription: authoritative } });

    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:replacement", providerReference: "sf_initial", providerSubscriptionId: "sub_replacement", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ handled: false, reason: "provider_identity_conflict" });

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.billingCreditEntry.create).not.toHaveBeenCalled();
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT" }) }));
  });

  it("treats a replayed persisted provider-identity conflict as a no-op", async () => {
    setup({ existingEvent: { id: "event_conflict", status: "REJECTED", failureCode: "PROVIDER_SUBSCRIPTION_CONFLICT" } });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:sub_replacement", providerReference: "sf_initial", providerSubscriptionId: "sub_replacement" })).resolves.toMatchObject({ handled: true, duplicate: true });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not let an unmatched replacement event mutate any tenant identity", async () => {
    setup();
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:unknown", providerReference: "unknown_checkout", providerSubscriptionId: "sub_other" })).resolves.toMatchObject({ handled: false, reason: "correlation" });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({ where: { provider: "PAYSTACK", providerSubscriptionId: "sub_other" } });
  });

  it("activates a recurring charge through providerSubscriptionId without checkout reference", async () => {
    const paidSubscription = { ...subscription, status: "PAST_DUE", pastDueEndsAt: new Date("2026-10-01"), providerSubscriptionId: "sub_code" };
    setup({ recurringSubscription: paidSubscription });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:txn_1", providerSubscriptionId: "sub_code", providerCustomerId: "customer_code", providerPlanCode: "PLN_GROWTH", amount: 1_500_000, currency: "NGN", currentPeriodEndsAt: new Date("2026-11-01") })).resolves.toMatchObject({ handled: true });
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({ where: { provider: "PAYSTACK", providerSubscriptionId: "sub_code" } });
    expect(prisma.billingInvoice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sub_1" }, data: expect.objectContaining({ status: "ACTIVE", pastDueEndsAt: null }) }));
  });

  it("awards a one-time referral credit only after a verified charge succeeds", async () => {
    setup({ initialCheckout: checkout });
    (prisma.referral.findUnique as jest.Mock).mockResolvedValue({ id: "referral_1", referrerBusinessId: "biz_referrer", status: "ATTRIBUTED", referrerBusiness: { subscription: { planCode: "STARTER" } } });
    await processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:first", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" });
    expect(prisma.billingCreditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: "biz_referrer", amount: 1_000_000, referralId: "referral_1" }) });

    setup({ initialCheckout: checkout });
    await processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:not-payment", providerReference: "sf_initial", providerSubscriptionId: "sub_code" });
    expect(prisma.billingCreditEntry.create).not.toHaveBeenCalled();
  });

  it("persists a normalized Paystack customer code on an initial charge without subscription timing", async () => {
    const initialStarterSubscription = { ...subscription, planCode: "STARTER", providerPlanCode: "PLN_STARTER" };
    const initialStarterCheckout = { ...checkout, planCode: "STARTER", providerPlanCode: "PLN_STARTER", amount: 1_000_000, subscription: initialStarterSubscription };
    setup({ initialCheckout: initialStarterCheckout });

    await expect(processVerifiedPaystackEvent({
      provider: "PAYSTACK",
      eventType: "charge.success",
      providerEventId: "charge.success:initial_starter",
      providerReference: "sf_initial",
      amount: 1_000_000,
      currency: "NGN",
      providerCustomerId: "CUS_INITIAL_TEST",
      providerPlanCode: "PLN_STARTER",
      // Initial Paystack charge.success observations do not include either
      // providerSubscriptionId or currentPeriodEndsAt.
    })).resolves.toMatchObject({ handled: true, duplicate: false });

    expect(prisma.billingInvoice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "ACTIVE",
        providerCustomerId: "CUS_INITIAL_TEST",
        providerPlanCode: "PLN_STARTER",
        providerSubscriptionId: null,
        currentPeriodEndsAt: null,
      }),
    }));
    expect(prisma.billingCheckout.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });

  it("moves a recurring provider-matched payment failure to PAST_DUE without suspension", async () => {
    const activeSubscription = { ...subscription, status: "ACTIVE", providerSubscriptionId: "sub_code" };
    setup({ recurringSubscription: activeSubscription });
    const failureAt = new Date("2026-10-01T00:00:00.000Z");
    await processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "invoice.payment_failed", providerEventId: "invoice.payment_failed:inv_1", providerSubscriptionId: "sub_code", amount: 1_500_000, currency: "NGN", occurredAt: failureAt });
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAST_DUE", pastDueEndsAt: new Date("2026-10-04T00:00:00.000Z") }) }));
    expect(JSON.stringify((prisma.subscription.update as jest.Mock).mock.calls)).not.toContain("SUSPENDED");
  });

  it("does not mutate a tenant for an unmatched recurring event", async () => {
    setup();
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:unknown", providerSubscriptionId: "unknown" })).resolves.toMatchObject({ handled: false, reason: "correlation" });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(1);
  });

  it("does not repeat billing work when a BillingEvent already exists", async () => {
    setup({ existingEvent: { id: "event_existing", status: "PROCESSED" } });
    await processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:txn_1", providerSubscriptionId: "sub_code" });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("retries the same FAILED event row and completes it without duplicating billing work", async () => {
    setup({ initialCheckout: checkout });
    (prisma.billingInvoice.upsert as jest.Mock).mockRejectedValueOnce(new Error("temporary invoice failure"));
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:retryable", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ retryable: true });
    expect(prisma.billingEvent.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", failureStage: "invoice_upsert" }) }));

    setup({ existingEvent: { id: "event_1", status: "FAILED", processingStartedAt: null }, initialCheckout: checkout });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:retryable", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ handled: true, duplicate: false });
    expect(prisma.billingInvoice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.billingCheckout.update).toHaveBeenCalledTimes(1);
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "event_1", status: { in: ["FAILED", "RECEIVED"] } }) }));
  });

  it("keeps a retryable event FAILED when its retry fails again with bounded diagnostics", async () => {
    setup({ existingEvent: { id: "event_1", status: "FAILED", processingStartedAt: null }, initialCheckout: checkout });
    (prisma.billingInvoice.upsert as jest.Mock).mockRejectedValueOnce(new Error("temporary invoice failure"));
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:retry-fails", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ retryable: true });
    expect(prisma.billingEvent.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", failureCode: "PROCESSING_FAILED", failureStage: "invoice_upsert" }) }));
  });

  it("does not reclaim an active PROCESSING delivery", async () => {
    setup({ existingEvent: { id: "event_1", status: "PROCESSING", processingStartedAt: new Date() }, initialCheckout: checkout });
    (prisma.billingEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:in-flight", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ handled: true, duplicate: true, reason: "processing" });
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
  });

  it("allows only one concurrent FAILED retry claimant to run side effects", async () => {
    setup({ existingEvent: { id: "event_1", status: "FAILED", processingStartedAt: null }, initialCheckout: checkout });
    (prisma.billingEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:failed-race", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ handled: true, duplicate: true, reason: "processing" });
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingCheckout.update).not.toHaveBeenCalled();
  });

  it("atomically reclaims only a stale PROCESSING delivery", async () => {
    setup({ existingEvent: { id: "event_1", status: "PROCESSING", processingStartedAt: new Date(Date.now() - 6 * 60_000) }, initialCheckout: checkout });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:stale", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ handled: true, duplicate: false });
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "PROCESSING", processingStartedAt: expect.objectContaining({ lte: expect.any(Date) }) }) }));
    expect(prisma.billingInvoice.upsert).toHaveBeenCalledTimes(1);
  });

  it("never retries a terminal REJECTED event", async () => {
    setup({ existingEvent: { id: "event_1", status: "REJECTED", failureCode: "VALIDATION_FAILED" }, initialCheckout: checkout });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:rejected", providerReference: "sf_initial", amount: 1_500_000, currency: "NGN" })).resolves.toMatchObject({ handled: true, duplicate: true, reason: "rejected" });
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("reconciles not-renewing and disabled events only through the persisted provider subscription", async () => {
    const paidSubscription = { ...subscription, status: "ACTIVE", providerSubscriptionId: "sub_code", providerEmailToken: "token_1" };
    setup({ recurringSubscription: paidSubscription });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.not_renew", providerEventId: "subscription.not_renew:sub_code", providerSubscriptionId: "sub_code", providerEmailToken: "token_2", currentPeriodEndsAt: new Date("2026-11-01") })).resolves.toMatchObject({ handled: true });
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cancelAtPeriodEnd: true, providerEmailToken: "token_2" }) }));
    setup({ recurringSubscription: paidSubscription });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.disable", providerEventId: "subscription.disable:sub_code", providerSubscriptionId: "sub_code" })).resolves.toMatchObject({ handled: true });
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED", cancelAtPeriodEnd: true }) }));
  });

  it("rejects cancellation events for an unknown provider subscription without cross-tenant fallback", async () => {
    setup();
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.disable", providerEventId: "subscription.disable:unknown", providerSubscriptionId: "unknown" })).resolves.toMatchObject({ reason: "correlation" });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});

describe("plan-based checkout safety", () => {
  const previousCallback = process.env.PAYSTACK_CALLBACK_URL;
  beforeEach(() => { jest.clearAllMocks(); process.env.PAYSTACK_CALLBACK_URL = "https://app.salonflow.test/settings/billing"; });
  afterAll(() => { if (previousCallback === undefined) delete process.env.PAYSTACK_CALLBACK_URL; else process.env.PAYSTACK_CALLBACK_URL = previousCallback; });

  it("refuses a replacement checkout while a provider subscription remains authoritative", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({
      id: "biz_1",
      subscription: { id: "sub_1", providerSubscriptionId: "sub_authoritative" },
      users: [{ email: "owner@example.test" }],
    });
    const provider = { getPlanCode: jest.fn(() => "PLN_GROWTH"), initializeCheckout: jest.fn() } as any;

    await expect(initializeBusinessCheckout({ businessId: "biz_1", actorUserId: "owner_1", planCode: "GROWTH", provider })).rejects.toThrow(/reconciliation/i);
    expect(prisma.billingCheckout.create).not.toHaveBeenCalled();
    expect(provider.initializeCheckout).not.toHaveBeenCalled();
  });

  it("still initializes a legitimate first checkout when no provider subscription exists", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({
      id: "biz_1",
      subscription: { id: "sub_1", status: "TRIALING", planCode: "GROWTH", providerSubscriptionId: null },
      users: [{ email: "owner@example.test" }],
    });
    (prisma.billingCheckout.create as jest.Mock).mockResolvedValue({ id: "checkout_1", reference: "sf_reference" });
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
    const provider = { getPlanCode: jest.fn(() => "PLN_GROWTH"), initializeCheckout: jest.fn().mockResolvedValue({ authorizationUrl: "https://checkout.test", accessCode: "access", providerReference: "sf_reference" }) } as any;

    await expect(initializeBusinessCheckout({ businessId: "biz_1", actorUserId: "owner_1", planCode: "GROWTH", provider })).resolves.toEqual({ authorizationUrl: "https://checkout.test", accessCode: "access", reference: "sf_reference" });
    expect(prisma.billingCheckout.create).toHaveBeenCalledTimes(1);
    expect(provider.initializeCheckout).toHaveBeenCalledTimes(1);
    expect(provider.initializeCheckout).toHaveBeenCalledWith(expect.objectContaining({ planCode: "GROWTH", amount: 1_500_000, callbackUrl: "https://app.salonflow.test/settings/billing" }));
  });

  it("keeps recovery on the current server-side plan", async () => {
    (prisma.business.findUnique as jest.Mock).mockResolvedValue({ id: "biz_1", subscription: { id: "sub_1", status: "SUSPENDED", planCode: "STARTER", providerSubscriptionId: null }, users: [{ email: "owner@example.test" }] });
    await expect(initializeBusinessCheckout({ businessId: "biz_1", actorUserId: "owner_1", planCode: "GROWTH", provider: {} as any })).rejects.toThrow(/current subscription plan/i);
    expect(prisma.billingCheckout.create).not.toHaveBeenCalled();
  });
});
