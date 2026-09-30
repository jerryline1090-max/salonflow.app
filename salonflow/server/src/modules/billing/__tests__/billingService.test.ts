jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { processVerifiedPaystackEvent } from "../billingService";

const subscription = { id: "sub_1", businessId: "biz_1", planCode: "GROWTH", status: "TRIALING", provider: "PAYSTACK", providerCustomerId: null, providerSubscriptionId: null, providerPlanCode: "PLN_GROWTH", trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: null, cancelAtPeriodEnd: false, createdAt: new Date(), updatedAt: new Date() };
const checkout = { id: "checkout_1", businessId: "biz_1", subscriptionId: "sub_1", provider: "PAYSTACK", reference: "sf_initial", planCode: "GROWTH", providerPlanCode: "PLN_GROWTH", amount: 1_500_000, currency: "NGN", status: "INITIALIZED", subscription };

function setup({ existingEvent = null as any, initialCheckout = null as any, recurringSubscription = null as any } = {}) {
  jest.clearAllMocks();
  (prisma.billingEvent.findUnique as jest.Mock).mockResolvedValue(existingEvent);
  (prisma.billingCheckout.findUnique as jest.Mock).mockResolvedValue(initialCheckout);
  (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(recurringSubscription);
  (prisma.billingEvent.create as jest.Mock).mockResolvedValue({ id: "event_1" });
  (prisma.billingEvent.update as jest.Mock).mockResolvedValue({});
  (prisma.billingInvoice.upsert as jest.Mock).mockResolvedValue({});
  (prisma.subscription.update as jest.Mock).mockResolvedValue({});
  (prisma.billingCheckout.update as jest.Mock).mockResolvedValue({});
  (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback(prisma));
}

describe("persistent Paystack webhook correlation", () => {
  it("persists verified subscription.create identity without activating or invoicing", async () => {
    setup({ initialCheckout: checkout });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:sub_code", providerReference: "sf_initial", providerSubscriptionId: "sub_code", providerCustomerId: "customer_code", providerPlanCode: "PLN_GROWTH" })).resolves.toMatchObject({ handled: true });
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerSubscriptionId: "sub_code", providerCustomerId: "customer_code", providerPlanCode: "PLN_GROWTH" }) }));
    expect((prisma.subscription.update as jest.Mock).mock.calls[0][0].data.status).toBeUndefined();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect((prisma.subscription.update as jest.Mock).mock.calls[0][0].where).toEqual({ id: "sub_1" });
  });

  it("treats an already-persisted subscription.create as a no-op", async () => {
    setup({ existingEvent: { id: "event_existing" } });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "subscription.create", providerEventId: "subscription.create:sub_code", providerReference: "sf_initial" })).resolves.toMatchObject({ duplicate: true });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("activates a recurring charge through providerSubscriptionId without checkout reference", async () => {
    const paidSubscription = { ...subscription, status: "PAST_DUE", pastDueEndsAt: new Date("2026-10-01"), providerSubscriptionId: "sub_code" };
    setup({ recurringSubscription: paidSubscription });
    await expect(processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:txn_1", providerSubscriptionId: "sub_code", providerCustomerId: "customer_code", providerPlanCode: "PLN_GROWTH", amount: 1_500_000, currency: "NGN", currentPeriodEndsAt: new Date("2026-11-01") })).resolves.toMatchObject({ handled: true });
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({ where: { provider: "PAYSTACK", providerSubscriptionId: "sub_code" } });
    expect(prisma.billingInvoice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sub_1" }, data: expect.objectContaining({ status: "ACTIVE", pastDueEndsAt: null }) }));
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
    setup({ existingEvent: { id: "event_existing" } });
    await processVerifiedPaystackEvent({ provider: "PAYSTACK", eventType: "charge.success", providerEventId: "charge.success:txn_1", providerSubscriptionId: "sub_code" });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
