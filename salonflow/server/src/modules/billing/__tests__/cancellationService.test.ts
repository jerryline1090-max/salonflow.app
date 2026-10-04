jest.mock("../../../lib/prisma");
import { prisma } from "../../../lib/prisma";
import { finalizeScheduledCancellation, scheduleCancellation, undoScheduledCancellation } from "../billingService";
import { reconcileKnownSubscription } from "../billingService";
import { resolveBusinessAccess } from "../../subscriptions/subscriptionService";
import { BillingProviderError } from "../billingProvider";

const active = { id: "sub", businessId: "biz", planCode: "STARTER" as const, status: "ACTIVE" as const, provider: "PAYSTACK", providerCustomerId: null, providerSubscriptionId: "SUB_1", providerEmailToken: "token_1", providerPlanCode: null, trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: new Date("2026-10-10"), cancelAtPeriodEnd: false, createdAt: new Date(), updatedAt: new Date() };
const provider = { disableSubscription: jest.fn().mockResolvedValue(undefined), enableSubscription: jest.fn().mockResolvedValue(undefined), getSubscriptionState: jest.fn() } as any;
beforeEach(() => { jest.clearAllMocks(); provider.disableSubscription.mockResolvedValue(undefined); provider.enableSubscription.mockResolvedValue(undefined); provider.getSubscriptionState.mockReset().mockResolvedValueOnce({ ...active, status: "NON_RENEWING" }).mockResolvedValue({ ...active, status: "ACTIVE" }); (prisma.auditLog.create as jest.Mock).mockResolvedValue({}); (prisma.subscription.update as jest.Mock).mockResolvedValue({ ...active, cancelAtPeriodEnd: true }); });
describe("billing cancellation", () => {
  it("disables provider renewal before scheduling locally and keeps access before period end", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(active); await scheduleCancellation("biz", "owner", provider); expect(provider.disableSubscription).toHaveBeenCalledWith({ providerSubscriptionId: "SUB_1", providerEmailToken: "token_1" }); expect(resolveBusinessAccess({ ...active, cancelAtPeriodEnd: true }, new Date("2026-10-09"))).toMatchObject({ allowed: true }); });
  it("does not mark local cancellation when provider disable fails", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(active); provider.disableSubscription.mockRejectedValueOnce(new Error("provider failed")); await expect(scheduleCancellation("biz", "owner", provider)).rejects.toThrow(); expect(prisma.subscription.update).not.toHaveBeenCalled(); });
  it("is idempotent when already scheduled", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...active, cancelAtPeriodEnd: true }); await scheduleCancellation("biz", "owner", provider); expect(provider.disableSubscription).not.toHaveBeenCalled(); expect(prisma.subscription.update).not.toHaveBeenCalled(); });
  it("finalizes only after a known period end and never for null", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...active, cancelAtPeriodEnd: true }); await finalizeScheduledCancellation("biz", new Date("2026-10-11")); expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CANCELLED" } })); jest.clearAllMocks(); (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...active, currentPeriodEndsAt: null, cancelAtPeriodEnd: true }); await finalizeScheduledCancellation("biz", new Date("2026-10-11")); expect(prisma.subscription.update).not.toHaveBeenCalled(); });
  it("undoes only before cancellation is effective after provider enable", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...active, cancelAtPeriodEnd: true }); await undoScheduledCancellation("biz", "owner", provider); expect(provider.enableSubscription).toHaveBeenCalledWith({ providerSubscriptionId: "SUB_1", providerEmailToken: "token_1" }); expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cancelAtPeriodEnd: false } })); });
  it("rejects undo after cancellation is effective without resurrection", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...active, status: "CANCELLED", cancelAtPeriodEnd: true, currentPeriodEndsAt: new Date("2020-10-01") }); await expect(undoScheduledCancellation("biz", "owner", provider)).rejects.toThrow(); expect(prisma.subscription.update).not.toHaveBeenCalled(); });
  it("reconciles only a known provider subscription once", async () => { const known = { ...active, provider: "PAYSTACK", providerSubscriptionId: "provider-sub", providerCustomerId: null, providerPlanCode: null }; (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(known); const provider = { getSubscriptionState: jest.fn().mockResolvedValue({ providerSubscriptionId: "provider-sub", providerCustomerId: "customer", providerPlanCode: "plan", currentPeriodEndsAt: new Date("2026-11-01") }) } as any; await expect(reconcileKnownSubscription("biz", provider)).resolves.toMatchObject({ reconciled: true, changed: true }); expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sub" }, data: expect.objectContaining({ providerCustomerId: "customer" }) })); });
  it("does not mutate unmatched or ambiguous provider reconciliation", async () => { (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...active, providerSubscriptionId: "provider-sub" }); const provider = { getSubscriptionState: jest.fn().mockResolvedValue({ providerSubscriptionId: "other" }) } as any; await expect(reconcileKnownSubscription("biz", provider)).resolves.toMatchObject({ reconciled: false }); expect(prisma.subscription.update).not.toHaveBeenCalled(); });
});

describe("verified provider undo", () => {
  let state: any;
  let remote: any;
  let adapter: any;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-03T00:00:00Z"));
    state = { ...active, providerCustomerId: "CUS_test", providerPlanCode: "PLN_test", cancelAtPeriodEnd: true };
    remote = { ...state, status: "NON_RENEWING" };
    adapter = { getSubscriptionState: jest.fn(async () => ({ ...remote })), enableSubscription: jest.fn(async () => { remote.status = "ACTIVE"; }) };
    (prisma.subscription.findUnique as jest.Mock).mockImplementation(async () => ({ ...state }));
    (prisma.subscription.update as jest.Mock).mockImplementation(async ({ data }) => { Object.assign(state, data); return { ...state }; });
  });
  afterEach(() => jest.useRealTimers());
  const noMutation = () => {
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  };
  it.each(["REJECTED", "TIMEOUT", "UNAVAILABLE", "MALFORMED_RESPONSE"] as const)("%s enable failure leaves scheduling and credentials intact", async kind => {
    const before = { ...state };
    adapter.enableSubscription.mockRejectedValueOnce(new BillingProviderError(kind, "safe failure", kind === "REJECTED" ? 400 : undefined));
    await expect(undoScheduledCancellation("biz", "owner", adapter)).rejects.toMatchObject({ kind });
    expect(state).toEqual(before);
    expect(adapter.getSubscriptionState).toHaveBeenCalledTimes(1);
    noMutation();
  });
  it("requires enable success then an ACTIVE read before updating and auditing once", async () => {
    const order: string[] = [];
    adapter.getSubscriptionState.mockImplementation(async () => { order.push(`read:${remote.status}`); return { ...remote }; });
    adapter.enableSubscription.mockImplementation(async () => { order.push("enable"); remote.status = "ACTIVE"; });
    (prisma.subscription.update as jest.Mock).mockImplementation(async ({ data }) => { order.push("local"); Object.assign(state, data); return { ...state }; });
    await undoScheduledCancellation("biz", "owner", adapter);
    expect(order).toEqual(["read:NON_RENEWING", "enable", "read:ACTIVE", "local"]);
    expect(state).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: false, providerEmailToken: "token_1", providerSubscriptionId: "SUB_1", currentPeriodEndsAt: active.currentPeriodEndsAt });
    await undoScheduledCancellation("biz", "owner", adapter);
    expect(adapter.enableSubscription).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "cancellation_undone", businessId: "biz" }) }));
  });
  it.each(["NON_RENEWING", "CANCELLED", undefined])("POST success followed by %s does not clear cancellation", async status => {
    adapter.enableSubscription.mockImplementation(async () => { remote.status = status; });
    await expect(undoScheduledCancellation("biz", "owner", adapter)).rejects.toMatchObject({ rejectionCategory: "STATE_CONFLICT" });
    expect(state.cancelAtPeriodEnd).toBe(true);
    noMutation();
  });
  it.each(["before", "after"])("a different email token %s enable is never silently persisted", async stage => {
    if (stage === "before") remote.providerEmailToken = "different-private-token";
    else adapter.enableSubscription.mockImplementation(async () => { remote.status = "ACTIVE"; remote.providerEmailToken = "different-private-token"; });
    await expect(undoScheduledCancellation("biz", "owner", adapter)).rejects.toMatchObject({ rejectionCategory: "CREDENTIAL_INVALID" });
    expect(state.providerEmailToken).toBe("token_1");
    if (stage === "before") expect(adapter.enableSubscription).not.toHaveBeenCalled();
    noMutation();
  });
  it.each(["providerSubscriptionId", "providerCustomerId", "providerPlanCode"])("mismatched %s cannot authorize undo", async field => {
    remote[field] = "different";
    await expect(undoScheduledCancellation("biz", "owner", adapter)).rejects.toMatchObject({ rejectionCategory: "CREDENTIAL_INVALID" });
    expect(adapter.enableSubscription).not.toHaveBeenCalled();
    noMutation();
  });
  it("a failed confirmation read cannot authorize local recovery", async () => {
    adapter.getSubscriptionState.mockResolvedValueOnce({ ...remote }).mockRejectedValueOnce(new BillingProviderError("TIMEOUT", "safe timeout"));
    await expect(undoScheduledCancellation("biz", "owner", adapter)).rejects.toMatchObject({ kind: "TIMEOUT" });
    noMutation();
  });
  it("a contradictory period requires reconciliation rather than guessing a date", async () => {
    adapter.enableSubscription.mockImplementation(async () => { remote.status = "ACTIVE"; remote.currentPeriodEndsAt = new Date("2026-11-10"); });
    await expect(undoScheduledCancellation("biz", "owner", adapter)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
    noMutation();
  });
});
