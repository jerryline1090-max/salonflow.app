jest.mock("../../../lib/prisma");
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { discoverMissingSubscription } from "../subscriptionDiscovery";
import { reconcileKnownSubscription } from "../billingService";
import { BillingProviderAdapter, BillingProviderError } from "../billingProvider";
import { checkProviderSubscriptionOwnership } from "../providerSubscriptionOwnership";
import { resolveBusinessAccess, summarizeSubscription } from "../../subscriptions/subscriptionService";
import { PaystackAdapter } from "../paystack/paystackAdapter";
import { FetchPaystackHttpClient } from "../paystack/paystackProviderFactory";

const mock = (fn: unknown) => fn as jest.Mock;
const paidAt = new Date("2026-10-02T01:06:16Z");
const payment = { reference: "sf_test", transactionId: "18446744073709551615", amount: 1000000, currency: "NGN", providerCustomerId: "CUS_test", providerPlanCode: "PLN_test", paidAt, domain: "test" };
const candidate = { providerSubscriptionId: "SUB_test", providerCustomerId: "CUS_test", providerPlanCode: "PLN_test", providerEmailToken: "fake_server_token", createdAt: paidAt, currentPeriodEndsAt: new Date("2026-11-02T01:06:00Z"), status: "ACTIVE" };
let state: any;
let provider: BillingProviderAdapter;
let inTransaction: boolean;
let persistedAudits: any[];
beforeEach(() => {
  jest.resetAllMocks();
  state = { id: "sub", businessId: "biz", provider: "PAYSTACK", providerSubscriptionId: null, providerEmailToken: null,
    providerCustomerId: "CUS_test", providerPlanCode: "PLN_test", planCode: "STARTER", status: "ACTIVE", cancelAtPeriodEnd: false,
    currentPeriodEndsAt: null, trialEndsAt: null, graceEndsAt: null, updatedAt: new Date(), createdAt: new Date() };
  inTransaction = false;
  persistedAudits = [];
  mock(prisma.subscription.findUnique).mockImplementation(async () => ({ ...state }));
  mock(prisma.subscription.findFirst).mockResolvedValue(null);
  mock(prisma.billingCheckout.findMany).mockResolvedValue([{ id: "checkout", reference: "sf_test", amount: 1000000, currency: "NGN", planCode: "STARTER", providerPlanCode: "PLN_test" }]);
  mock(prisma.billingCheckout.findFirst).mockResolvedValue({ id: "checkout" });
  mock(prisma.billingInvoice.findFirst).mockResolvedValue({ id: "invoice" });
  mock(prisma.billingEvent.findFirst).mockResolvedValue({ id: "event" });
  mock(prisma.auditLog.create).mockImplementation(async ({ data }) => {
    persistedAudits.push(data);
    return data;
  });
  mock(prisma.subscription.updateMany).mockImplementation(async ({ where, data }) => {
    if (state.providerSubscriptionId !== where.providerSubscriptionId) return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  });
  mock(prisma.$transaction).mockImplementation(async run => {
    const saved = { ...state };
    const savedAudits = [...persistedAudits];
    inTransaction = true;
    try { return await run(prisma); } catch (e) { state = saved; persistedAudits = savedAudits; throw e; } finally { inTransaction = false; }
  });
  provider = {
    verifyInitialPayment: jest.fn(async () => { expect(inTransaction).toBe(false); return payment; }),
    discoverSubscriptions: jest.fn(async () => { expect(inTransaction).toBe(false); return { outcome: "exactly_one", candidate }; }),
  } as unknown as BillingProviderAdapter;
});
const run = () => discoverMissingSubscription("biz", provider);
function expectNoWrite() {
  expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
}

describe("verified initial subscription discovery", () => {
  it.each(["9007199254740992", "9007199254740993", "18446744073709551615"])("finds exact processed evidence for raw verification ID %s", async id => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(new Response(`{"status":true,"data":{"id":${id},"status":"success","reference":"sf_test","amount":1000000,"currency":"NGN","domain":"test","paid_at":"2026-10-02T01:06:16Z","customer":{"customer_code":"CUS_test"},"plan":{"plan_code":"PLN_test"}}}`));
    const adapter = new PaystackAdapter({ secretKey: "sk_test_fake_only", timeoutMs: 1000, planCodes: { STARTER: "PLN_test", GROWTH: "PLN_fake", PRO: "PLN_fake" } }, new FetchPaystackHttpClient());
    provider.verifyInitialPayment = adapter.verifyInitialPayment.bind(adapter);
    mock(prisma.billingEvent.findFirst).mockImplementation(async ({ where }) => where.providerEventId === `charge.success:${id}` && where.businessId === "biz" && where.status === "PROCESSED" ? { id: "event" } : null);
    try {
      await expect(run()).resolves.toMatchObject({ outcome: "reconciled" });
      expect(provider.discoverSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ transactionId: id }));
      expect(prisma.billingEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerEventId: `charge.success:${id}`, businessId: "biz", status: "PROCESSED" }) }));
    } finally { global.fetch = originalFetch; }
  });
  it("uses only the local 15-second Serializable budget and commits attachment with its audit", async () => {
    mock(prisma.auditLog.create).mockImplementationOnce(async ({ data }) => {
      expect(inTransaction).toBe(true);
      expect(state).toMatchObject({ providerSubscriptionId: "SUB_test", providerEmailToken: candidate.providerEmailToken });
      persistedAudits.push(data);
      return data;
    });
    await expect(run()).resolves.toEqual({ outcome: "reconciled", reconciled: true, changed: true });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000,
    });
    expect(state.currentPeriodEndsAt).toEqual(candidate.currentPeriodEndsAt);
    expect(persistedAudits).toHaveLength(1);
    expect(persistedAudits[0]).toMatchObject({ businessId: "biz", resourceId: "sub", action: "subscription_provider_discovered" });
  });
  it.each(["read", "audit", "commit"])("P2028 at %s fails closed without persisted attachment or audit", async stage => {
    const before = { ...state };
    let reachedTransactionEnd = false;
    const timeout = Object.assign(new Error(`private Prisma timeout ${candidate.providerEmailToken}`), { code: "P2028" });
    if (stage === "read") {
      mock(prisma.subscription.findUnique).mockResolvedValueOnce({ ...state }).mockRejectedValueOnce(timeout);
    } else if (stage === "audit") {
      mock(prisma.auditLog.create).mockRejectedValueOnce(timeout);
    } else {
      mock(prisma.$transaction).mockImplementationOnce(async operation => {
        const saved = { ...state }, savedAudits = [...persistedAudits];
        inTransaction = true;
        try {
          await operation(prisma);
          expect(state.providerSubscriptionId).toBe("SUB_test");
          expect(persistedAudits).toHaveLength(1);
          reachedTransactionEnd = true;
          throw timeout;
        } finally {
          state = saved;
          persistedAudits = savedAudits;
          inTransaction = false;
        }
      });
    }
    const response = await run();
    expect(response).toEqual({ outcome: "indeterminate", reconciled: false, changed: false });
    expect(state).toEqual(before);
    expect(state.providerSubscriptionId).toBeNull();
    expect(state.providerEmailToken).toBeNull();
    expect(persistedAudits).toHaveLength(0);
    expect(JSON.stringify(response)).not.toMatch(/P2028|Prisma|private|fake_server_token/);
    if (stage === "read") expectNoWrite();
    else {
      expect(prisma.subscription.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    }
    if (stage === "commit") expect(reachedTransactionEnd).toBe(true);
  });
  it("recovers missing subscription.create through the existing reconciliation path", async () => {
    await expect(reconcileKnownSubscription("biz", provider)).resolves.toMatchObject({ outcome: "reconciled" });
    expect(state).toMatchObject({ providerSubscriptionId: "SUB_test", providerEmailToken: "fake_server_token", currentPeriodEndsAt: candidate.currentPeriodEndsAt, status: "ACTIVE" });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz", id: "sub", providerSubscriptionId: null }) }));
    expect(prisma.billingEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerEventId: "charge.success:18446744073709551615", status: "PROCESSED", businessId: "biz" }) }));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "subscription_provider_discovered" }) }));
  });
  it("is same-ID idempotent with one audit", async () => {
    await run();
    await expect(run()).resolves.toMatchObject({ outcome: "already_reconciled" });
    expect(prisma.subscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it("two concurrent discoveries attach once and audit once", async () => {
    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    mock(provider.discoverSubscriptions).mockImplementation(async () => {
      if (++entered === 2) release();
      await barrier;
      return { outcome: "exactly_one", candidate };
    });
    const responses = await Promise.all([run(), run()]);
    expect(responses.map(r => r.outcome).sort()).toEqual(["already_reconciled", "reconciled"]);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(state.providerSubscriptionId).toBe("SUB_test");
  });
  it("uses no local timestamp as the payment anchor", async () => {
    await run();
    expect(provider.verifyInitialPayment).toHaveBeenCalledWith({ reference: "sf_test", amount: 1000000, currency: "NGN", providerCustomerId: "CUS_test", providerPlanCode: "PLN_test" });
    expect(provider.discoverSubscriptions).toHaveBeenCalledWith(payment);
  });
  it.each(["not_found", "ambiguous"])("preserves provider %s without mutation", async outcome => {
    mock(provider.discoverSubscriptions).mockResolvedValue({ outcome });
    await expect(run()).resolves.toMatchObject({ outcome });
    expectNoWrite();
  });
  it.each(["customer", "plan", "old", "token"])("rejects inconsistent normalized candidate: %s", async change => {
    const c: any = { ...candidate };
    if (change === "customer") c.providerCustomerId = "other";
    if (change === "plan") c.providerPlanCode = "other";
    if (change === "old") c.createdAt = new Date("2026-09-01");
    if (change === "token") c.providerEmailToken = "";
    mock(provider.discoverSubscriptions).mockResolvedValue({ outcome: "exactly_one", candidate: c });
    await expect(run()).resolves.toMatchObject({ outcome: "indeterminate" });
    expectNoWrite();
  });
  it.each(["TIMEOUT", "UNAVAILABLE", "REJECTED", "MALFORMED_RESPONSE"])("does not convert %s provider failure to not_found or expose errors", async kind => {
    mock(provider.discoverSubscriptions).mockRejectedValue(new BillingProviderError(kind as any, "fake_server_token"));
    const response = await run();
    expect(response.outcome).toBe(kind === "MALFORMED_RESPONSE" ? "indeterminate" : "provider_unavailable");
    expect(JSON.stringify(response)).not.toContain("fake_server_token");
    expectNoWrite();
  });
  it("rechecks evidence inside the write transaction", async () => {
    mock(prisma.billingEvent.findFirst).mockResolvedValueOnce({ id: "event" }).mockResolvedValueOnce(null);
    await expect(run()).resolves.toMatchObject({ outcome: "conflict" });
    expectNoWrite();
  });
  it("requires processed transaction-specific evidence before searching", async () => {
    mock(prisma.billingEvent.findFirst).mockResolvedValue(null);
    await expect(run()).resolves.toMatchObject({ outcome: "indeterminate" });
    expect(provider.discoverSubscriptions).not.toHaveBeenCalled();
    expectNoWrite();
  });
  it.each(["same", "different", "other-business"])("handles %s ownership race without overwrite", async race => {
    mock(provider.discoverSubscriptions).mockImplementation(async () => {
      if (race === "other-business") mock(prisma.subscription.findFirst).mockResolvedValue({ id: "other-sub" });
      else state.providerSubscriptionId = race === "same" ? "SUB_test" : "SUB_other";
      return { outcome: "exactly_one", candidate };
    });
    await expect(run()).resolves.toMatchObject({ outcome: race === "same" ? "already_reconciled" : "conflict" });
    expectNoWrite();
  });
  it("blocks a preexisting different provider identity", async () => {
    state.providerSubscriptionId = "SUB_other";
    await expect(run()).resolves.toMatchObject({ outcome: "conflict" });
    expectNoWrite();
  });
  it.each(["P2002", "P2034"])("resolves database %s race safely", async code => {
    mock(prisma.$transaction).mockImplementationOnce(async () => { state.providerSubscriptionId = "SUB_test"; throw { code }; });
    await expect(run()).resolves.toMatchObject({ outcome: "already_reconciled" });
    expectNoWrite();
  });
  it("maps unique ownership violation in another business to conflict", async () => {
    mock(prisma.$transaction).mockImplementationOnce(async () => { mock(prisma.subscription.findFirst).mockResolvedValue({ id: "other" }); throw { code: "P2002" }; });
    await expect(run()).resolves.toMatchObject({ outcome: "conflict" });
    expectNoWrite();
  });
  it("handles a lost conditional update as idempotent without a second audit", async () => {
    mock(prisma.subscription.updateMany).mockImplementationOnce(async () => { state.providerSubscriptionId = "SUB_test"; return { count: 0 }; });
    await expect(run()).resolves.toMatchObject({ outcome: "already_reconciled" });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  it("rolls attachment back on audit failure", async () => {
    mock(prisma.auditLog.create).mockRejectedValueOnce(new Error("private error"));
    await expect(run()).resolves.toMatchObject({ outcome: "indeterminate" });
    expect(state.providerSubscriptionId).toBeNull();
  });
  it("reflects non-renewal atomically and preserves access until the known period end", async () => {
    mock(provider.discoverSubscriptions).mockResolvedValue({ outcome: "exactly_one", candidate: { ...candidate, status: "NON_RENEWING" } });
    await run();
    expect(state.cancelAtPeriodEnd).toBe(true);
    expect(resolveBusinessAccess(state, new Date("2026-11-01"))).toMatchObject({ allowed: true });
    expect(resolveBusinessAccess(state, candidate.currentPeriodEndsAt)).toMatchObject({ allowed: false, effectiveStatus: "CANCELLED" });
  });
  it("never exposes token in service results, public DTOs, audit or console output", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await run();
      const publicData = [response, summarizeSubscription(state), mock(prisma.auditLog.create).mock.calls, log.mock.calls, error.mock.calls];
      expect(JSON.stringify(publicData)).not.toContain("fake_server_token");
      expect(JSON.stringify(publicData)).not.toContain("providerEmailToken");
    } finally { log.mockRestore(); error.mockRestore(); }
  });
});

describe("ownership migration duplicate preflight", () => {
  it("permits no duplicates and excludes null ownership pairs", async () => {
    mock(prisma.subscription.groupBy).mockResolvedValue([]);
    await expect(checkProviderSubscriptionOwnership(prisma)).resolves.toEqual({ safeToMigrate: true, duplicates: [] });
    expect(prisma.subscription.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["provider", "providerSubscriptionId"], where: { provider: { not: null }, providerSubscriptionId: { not: null } } }));
    expectNoWrite();
  });
  it("reports duplicates and blocks deployment without repair", async () => {
    const duplicates = [{ provider: "PAYSTACK", providerSubscriptionId: "SUB_duplicate", _count: { _all: 2 } }];
    mock(prisma.subscription.groupBy).mockResolvedValue(duplicates);
    await expect(checkProviderSubscriptionOwnership(prisma)).resolves.toEqual({ safeToMigrate: false, duplicates });
    expectNoWrite();
  });
});
