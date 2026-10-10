// Opt-in, synthetic fixtures only. No runtime DATABASE_URL fallback, no cleanup.
jest.mock("../../../lib/prisma", () => {
  const { postgresHarnessUrl } = jest.requireActual("../../appointments/__tests__/postgresHarnessGuard");
  const { PrismaClient } = jest.requireActual("@prisma/client");
  const env = { ...process.env, RUN_APPOINTMENT_POSTGRES_TESTS:
    process.env.RUN_LIFECYCLE_POSTGRES_TESTS === "approved-disposable" ? "approved-disposable" : undefined };
  const url = postgresHarnessUrl(env);
  return { prisma: url ? new PrismaClient({ log: [], datasources: { db: { url } } }) : undefined };
});
import { randomUUID } from "crypto";
import { prisma } from "../../../lib/prisma";
import { processCommercialLifecycle } from "../lifecycleProcessor";

const suite = prisma ? describe : describe.skip;
suite("R10 real PostgreSQL (fixed disposable identity, explicit opt-in)", () => {
  jest.setTimeout(180_000);
  const now = new Date();
  const DAY = 86400000;
  const ids: string[] = [];
  const originalTransaction = prisma?.$transaction.bind(prisma);
  let visible: string[] = [];
  let transactionSpy: jest.SpyInstance;
  beforeAll(async () => {
    await prisma.$connect();
    const findMany = prisma.subscription.findMany.bind(prisma.subscription);
    // Processor scans ONLY fixtures created by this test, never pre-existing rows.
    jest.spyOn(prisma.subscription, "findMany").mockImplementation((args: any) =>
      findMany({ ...args, where: { AND: [args.where, { id: { in: visible } }] } }) as any);
    transactionSpy = jest.spyOn(prisma, "$transaction");
    transactionSpy.mockImplementation(originalTransaction as any);
  });
  afterAll(async () => { jest.restoreAllMocks(); await prisma.$disconnect(); });
  async function fixture(data: any, id = "r10_" + randomUUID()) {
    ids.push(id);
    await prisma.business.create({ data: { id, name: "Synthetic R10 lifecycle fixture",
      subscription: { create: { id, planCode: "STARTER", status: "TRIALING",
        trialEndsAt: new Date(now.getTime() + 14 * DAY), ...data } } } });
    visible = [id];
    return id;
  }
  async function counts(id: string) {
    return {
      events: await prisma.subscriptionLifecycleEvent.count({ where: { subscriptionId: id } }),
      notices: await prisma.notification.count({ where: { businessId: id } }),
      audits: await prisma.auditLog.count({ where: { businessId: id } }),
      subscription: await prisma.subscription.findUniqueOrThrow({ where: { id } }),
    };
  }
  function intercept(read: (current: any) => Promise<void>, failNotification = false) {
    transactionSpy.mockImplementation(((work: any, options: any) => originalTransaction!(async (tx: any) => {
      const wrapped = new Proxy(tx, { get(target, property) {
        if (property === "subscription") return new Proxy(target.subscription, { get(model, operation) {
          if (operation === "findUnique") return async (args: any) => {
            const current = await model.findUnique(args);
            await read(current);
            return current;
          };
          return model[operation];
        } });
        if (property === "notification" && failNotification) return { create: async () => { throw new Error("Forced rollback fixture"); } };
        return target[property];
      } });
      return work(wrapped);
    }, options)) as any);
  }
  function barrier() {
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    return async () => {
      if (++arrived <= 2) { if (arrived === 2) release(); await gate; }
    };
  }
  it("concurrent reminders, duplicate claim and later cycle are atomic", async () => {
    const id = await fixture({ status: "PAST_DUE", pastDueEndsAt: new Date(now.getTime() + DAY) });
    intercept(barrier());
    const results = await Promise.all([processCommercialLifecycle(now), processCommercialLifecycle(now)]);
    expect(results.reduce((sum, r) => sum + r.failed, 0)).toBe(0);
    expect(await counts(id)).toMatchObject({ events: 1, notices: 1, audits: 0 });
    transactionSpy.mockImplementation(originalTransaction as any);
    expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(0);
    // A duplicate ON CONFLICT must leave the same transaction usable.
    const event = await prisma.subscriptionLifecycleEvent.findFirstOrThrow({ where: { subscriptionId: id } });
    await originalTransaction!(async tx => {
      expect((await tx.subscriptionLifecycleEvent.createMany({ data: [{
        subscriptionId: id, businessId: id, eventKey: event.eventKey,
      }], skipDuplicates: true })).count).toBe(0);
      expect(await tx.subscription.findUnique({ where: { id } })).not.toBeNull();
    });
    await prisma.subscription.update({ where: { id }, data: { pastDueEndsAt: new Date(now.getTime() + 31 * DAY) } });
    await processCommercialLifecycle(new Date(now.getTime() + 30 * DAY));
    expect(await counts(id)).toMatchObject({ events: 2, notices: 2, audits: 0 });
  });
  it("concurrent same transition commits one event/audit/notification", async () => {
    const id = await fixture({ trialEndsAt: now });
    intercept(barrier());
    const results = await Promise.all([processCommercialLifecycle(now), processCommercialLifecycle(now)]);
    expect(results.reduce((sum, r) => sum + r.transitioned, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.failed, 0)).toBe(0);
    expect(await counts(id)).toMatchObject({ events: 1, notices: 1, audits: 1, subscription: { status: "GRACE_PERIOD" } });
    transactionSpy.mockImplementation(originalTransaction as any);
  });
  it.each(["extension", "recovery"])("stale suspension loses to %s", async mode => {
    const id = await fixture({ status: "PAST_DUE", pastDueEndsAt: now });
    let once = false;
    intercept(async () => {
      if (once) return;
      once = true;
      await prisma.subscription.update({ where: { id }, data: mode === "recovery"
        ? { status: "ACTIVE", pastDueEndsAt: null } : { pastDueEndsAt: new Date(now.getTime() + 3 * DAY) } });
    });
    expect((await processCommercialLifecycle(now)).transitioned).toBe(0);
    const result = await counts(id);
    expect(result).toMatchObject({ events: 0, notices: 0, audits: 0 });
    expect(result.subscription.status).toBe(mode === "recovery" ? "ACTIVE" : "PAST_DUE");
    transactionSpy.mockImplementation(originalTransaction as any);
  });
  it("forced notification error rolls back state/event/audit; retry succeeds once", async () => {
    const id = await fixture({ trialEndsAt: now });
    intercept(async () => {}, true);
    expect((await processCommercialLifecycle(now)).failed).toBe(1);
    expect(await counts(id)).toMatchObject({ events: 0, notices: 0, audits: 0, subscription: { status: "TRIALING" } });
    transactionSpy.mockImplementation(originalTransaction as any);
    await processCommercialLifecycle(now);
    await processCommercialLifecycle(now);
    expect(await counts(id)).toMatchObject({ events: 1, notices: 1, audits: 1 });
  });
  it("legacy ambiguity cannot mutate state or prevent another fixture processing", async () => {
    const prefix = "r10_" + randomUUID();
    const blocked = await fixture({ status: "PAST_DUE", pastDueEndsAt: now }, prefix + "-0");
    await prisma.subscriptionLifecycleEvent.create({ data: { subscriptionId: blocked, businessId: blocked, eventKey: "past_due.suspended" } });
    const good = await fixture({}, prefix + "-1");
    visible = [blocked, good];
    expect(await processCommercialLifecycle(now)).toMatchObject({ blocked: 1, notificationsCreated: 1 });
    expect(await counts(blocked)).toMatchObject({ events: 1, notices: 0, audits: 0, subscription: { status: "PAST_DUE" } });
    expect(await counts(good)).toMatchObject({ events: 1, notices: 1, audits: 0 });
  });
});
