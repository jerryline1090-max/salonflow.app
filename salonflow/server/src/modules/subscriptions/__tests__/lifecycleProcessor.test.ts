jest.mock("../../../lib/prisma");
import { prisma } from "../../../lib/prisma";
import { processCommercialLifecycle } from "../lifecycleProcessor";

const stale = { id: "sub", businessId: "biz", status: "GRACE_PERIOD", planCode: "STARTER", trialEndsAt: null, graceEndsAt: new Date("2020-01-01"), pastDueEndsAt: null, currentPeriodEndsAt: null, cancelAtPeriodEnd: false, createdAt: new Date(), updatedAt: new Date() };
describe("commercial lifecycle processor", () => {
  beforeEach(() => { jest.clearAllMocks(); (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(prisma)); });
  it.each(["GRACE_PERIOD", "PAST_DUE"])("does not overwrite a stale %s candidate that became ACTIVE", async (status) => {
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ ...stale, status, pastDueEndsAt: status === "PAST_DUE" ? new Date("2020-01-01") : null }]);
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...stale, status: "ACTIVE" });
    const result = await processCommercialLifecycle(new Date("2026-01-01"));
    expect(result).toMatchObject({ evaluated: 1, transitioned: 0, failed: 0 });
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  it("continues after one subscription transaction fails", async () => {
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ ...stale, id: "bad" }, { ...stale, id: "good" }]);
    (prisma.$transaction as jest.Mock).mockImplementationOnce(() => { throw new Error("boom"); }).mockImplementationOnce((cb: any) => cb(prisma));
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...stale, id: "good" });
    (prisma.subscription.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({}); (prisma.subscriptionLifecycleEvent.create as jest.Mock).mockResolvedValue({}); (prisma.notification.create as jest.Mock).mockResolvedValue({});
    await expect(processCommercialLifecycle(new Date("2026-01-01"))).resolves.toMatchObject({ evaluated: 2, transitioned: 1, failed: 1 });
  });
  it("treats P2002 lifecycle-event collisions as a non-fatal no-op", async () => {
    (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ ...stale, status: "TRIALING", trialEndsAt: new Date("2026-01-14") }]);
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ ...stale, status: "TRIALING", trialEndsAt: new Date("2026-01-14") });
    (prisma.subscription.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
    (prisma.subscriptionLifecycleEvent.create as jest.Mock).mockRejectedValue({ code: "P2002" });
    const result = await processCommercialLifecycle(new Date("2026-01-14"));
    expect(result.failed).toBe(0);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
