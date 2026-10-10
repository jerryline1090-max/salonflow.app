jest.mock("../../../lib/prisma");
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { processCommercialLifecycle } from "../lifecycleProcessor";

const DAY = 86400000;
const now = new Date("2026-02-15T00:00:00Z");
const base = (id = "sub", overrides: any = {}): any => ({
  id, businessId: id + "_biz", status: "TRIALING", planCode: "STARTER",
  trialEndsAt: new Date(now.getTime() + 14 * DAY), graceEndsAt: null, pastDueEndsAt: null,
  currentPeriodEndsAt: null, cancelAtPeriodEnd: false, ...overrides,
});
let rows: any[], events: any[], notices: any[], audits: any[];
let failId: string | undefined, failStage: string | undefined;
let race: ((row: any) => void) | undefined;
let tx: any;
beforeEach(() => {
  rows = [base()]; events = []; notices = []; audits = []; failId = undefined; failStage = undefined; race = undefined;
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  (prisma.subscription.findMany as jest.Mock).mockImplementation(async ({ where, take }) =>
    rows.filter(r => !where.id || r.id > where.id.gt).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(r => ({ id: r.id })));
  tx = {
    subscription: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id === failId) throw new Error("sensitive fixture must not be logged");
        return structuredClone(rows.find(r => r.id === where.id) ?? null);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.find(r => r.id === where.id);
        if (race) { race(row); race = undefined; }
        if (!row || Object.entries(where).some(([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value))) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    subscriptionLifecycleEvent: {
      findUnique: jest.fn(async ({ where }: any) => events.find(e => e.subscriptionId === where.subscriptionId_eventKey.subscriptionId && e.eventKey === where.subscriptionId_eventKey.eventKey) ?? null),
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        expect(skipDuplicates).toBe(true);
        if (failStage === "claim") throw new Prisma.PrismaClientKnownRequestError("fixture", { code: "P2002", clientVersion: "test" });
        const e = data[0];
        if (events.some(old => old.subscriptionId === e.subscriptionId && old.eventKey === e.eventKey)) return { count: 0 };
        events.push({ ...e, createdAt: now }); return { count: 1 };
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); }) },
    notification: { create: jest.fn(async ({ data }: any) => {
      if (failStage === "notification") throw new Error("private error");
      notices.push(data);
    }) },
  };
  (prisma.$transaction as jest.Mock).mockImplementation(async (work: any) => {
    const saved = structuredClone({ rows, events, notices, audits });
    try { return await work(tx); }
    catch (e) { ({ rows, events, notices, audits } = saved); throw e; }
  });
});
afterEach(() => jest.restoreAllMocks());
const key = (type: string, boundary: Date) => `v2:${type}:${boundary.toISOString()}`;

it.each([[0, 1], [5, 1], [6, 7], [9, 7], [10, 11], [12, 13], [13, 14]])("elapsed day offset %s selects only milestone %s and is idempotent", async (elapsed, milestone) => {
  rows[0].trialEndsAt = new Date(now.getTime() + (14 - elapsed) * DAY);
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(1);
  expect(events.map(e => e.eventKey)).toEqual([key("trial.day" + milestone, rows[0].trialEndsAt)]);
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(0);
  expect(notices).toHaveLength(1); expect(audits).toHaveLength(0);
});
it.each([0, -DAY])("expired trial gives transition precedence, no stale milestone (%s)", async delta => {
  rows[0].trialEndsAt = new Date(now.getTime() + delta);
  expect((await processCommercialLifecycle(now)).transitioned).toBe(1);
  expect(rows[0].status).toBe("GRACE_PERIOD");
  expect(rows[0].graceEndsAt.getTime()).toBe(rows[0].trialEndsAt.getTime() + 3 * DAY);
  expect(events[0].eventKey).toBe(key("trial.grace_started", rows[0].trialEndsAt));
  expect(events).toHaveLength(1);
});
it.each(["GRACE_PERIOD", "PAST_DUE"])("%s reminder is [deadline-24h, deadline), then transition wins", async status => {
  const field = status === "GRACE_PERIOD" ? "graceEndsAt" : "pastDueEndsAt";
  rows[0] = base("sub", { status, [field]: new Date(now.getTime() + DAY) });
  expect((await processCommercialLifecycle(new Date(now.getTime() - 1))).notificationsCreated).toBe(0);
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(1);
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(0);
  expect((await processCommercialLifecycle(rows[0][field])).transitioned).toBe(1);
  expect(notices).toHaveLength(2);
});
it.each(["past_due.recovery", "past_due.suspended", "cancellation.effective"])("legacy %s blocks without side effects and continues", async type => {
  rows = [base("a", type === "cancellation.effective"
    ? { status: "ACTIVE", cancelAtPeriodEnd: true, currentPeriodEndsAt: now }
    : { status: "PAST_DUE", pastDueEndsAt: new Date(now.getTime() + (type.endsWith("recovery") ? DAY : 0)) }), base("b")];
  const original = structuredClone(rows[0]);
  events = [{ subscriptionId: "a", eventKey: type, createdAt: new Date("2020-01-01") }];
  expect(await processCommercialLifecycle(now)).toMatchObject({ blocked: 1, failed: 0, notificationsCreated: 1 });
  expect(rows[0]).toEqual(original);
  expect(events).toHaveLength(2); expect(notices[0].businessId).toBe("b_biz"); expect(audits).toHaveLength(0);
  expect(console.warn).toHaveBeenCalledWith("Commercial lifecycle blocked", { code: "LEGACY_AMBIGUOUS", subscriptionId: "a", eventType: type });
});
it.each([true, false])("reliable legacy trial same occurrence=%s", async same => {
  events = [{ subscriptionId: "sub", eventKey: "trial.day1", createdAt: new Date(now.getTime() - (same ? 0 : DAY)) }];
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(same ? 0 : 1);
  expect(events).toHaveLength(same ? 1 : 2);
});
it("past-due v2 reminder and suspension recur in a later cycle", async () => {
  for (const shift of [0, 30 * DAY]) {
    const deadline = new Date(now.getTime() + shift + DAY);
    Object.assign(rows[0], { status: "PAST_DUE", pastDueEndsAt: deadline });
    await processCommercialLifecycle(new Date(deadline.getTime() - DAY));
    await processCommercialLifecycle(deadline);
    await processCommercialLifecycle(deadline);
  }
  expect(events).toHaveLength(4); expect(notices).toHaveLength(4); expect(audits).toHaveLength(2);
});
it("traverses >100 including failed/no-op/ambiguous first records with immutable ID cursor", async () => {
  rows = Array.from({ length: 205 }, (_, i) => base(String(i).padStart(3, "0")));
  failId = "000"; rows[1].status = "CANCELLED";
  Object.assign(rows[2], { status: "PAST_DUE", pastDueEndsAt: now });
  events = [{ subscriptionId: "002", eventKey: "past_due.suspended", createdAt: now }];
  expect(await processCommercialLifecycle(now)).toEqual({ evaluated: 205, failed: 1, blocked: 1, transitioned: 0, notificationsCreated: 202 });
  expect(prisma.subscription.findMany).toHaveBeenCalledTimes(3);
  const calls = (prisma.subscription.findMany as jest.Mock).mock.calls;
  expect(calls[1][0].where.id).toEqual({ gt: "099" });
  expect(calls[2][0].where.id).toEqual({ gt: "199" });
  for (const [args] of calls) { expect(args.orderBy).toEqual({ id: "asc" }); expect(args.take).toBe(100); }
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain("sensitive");
});
it.each(["TRIALING", "GRACE_PERIOD", "PAST_DUE"])("concurrent ACTIVE defeats stale %s transition", async status => {
  rows[0] = base("sub", { status, trialEndsAt: now, graceEndsAt: now, pastDueEndsAt: now });
  race = row => { row.status = "ACTIVE"; };
  expect((await processCommercialLifecycle(now)).transitioned).toBe(0);
  expect(rows[0].status).toBe("ACTIVE");
  expect(events).toHaveLength(0); expect(audits).toHaveLength(0); expect(notices).toHaveLength(0);
});
it.each(["graceEndsAt", "pastDueEndsAt", "currentPeriodEndsAt"])("concurrent %s extension defeats stale transition", async field => {
  rows[0] = base("sub", { status: field === "graceEndsAt" ? "GRACE_PERIOD" : field === "pastDueEndsAt" ? "PAST_DUE" : "ACTIVE",
    [field]: now, cancelAtPeriodEnd: field === "currentPeriodEndsAt" });
  race = row => { row[field] = new Date(now.getTime() + DAY); };
  expect((await processCommercialLifecycle(now)).transitioned).toBe(0);
  expect(events).toHaveLength(0); expect(audits).toHaveLength(0); expect(notices).toHaveLength(0);
});
it.each(["claim", "notification"])("arbitrary %s failure rolls back, does not continue poisoned tx, retry succeeds", async stage => {
  rows[0].trialEndsAt = now; failStage = stage;
  expect((await processCommercialLifecycle(now)).failed).toBe(1);
  expect(rows[0].status).toBe("TRIALING");
  expect(events).toHaveLength(0); expect(audits).toHaveLength(0); expect(notices).toHaveLength(0);
  if (stage === "claim") expect(tx.notification.create).not.toHaveBeenCalled();
  failStage = undefined;
  expect((await processCommercialLifecycle(now)).transitioned).toBe(1);
  await processCommercialLifecycle(now);
  expect(notices).toHaveLength(1);
});
it("already-claimed transition rolls back state and emits no second audit/notification", async () => {
  rows[0].trialEndsAt = now;
  events = [{ subscriptionId: "sub", eventKey: key("trial.grace_started", now), createdAt: now }];
  expect((await processCommercialLifecycle(now)).transitioned).toBe(0);
  expect(rows[0].status).toBe("TRIALING");
  expect(notices).toHaveLength(0); expect(audits).toHaveLength(0);
});
it("bounded serialization retry uses a fresh full transaction", async () => {
  (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(1);
  expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
});

it.each(["trial.grace_ending", "trial.suspended"])("reliable grace legacy %s uses the single persisted trial/grace occurrence", async type => {
  const deadline = new Date(now.getTime() + (type.endsWith("ending") ? DAY : 0));
  rows[0] = base("sub", { status: "GRACE_PERIOD", graceEndsAt: deadline, trialEndsAt: new Date(deadline.getTime() - 3 * DAY) });
  events = [{ subscriptionId: "sub", eventKey: type, createdAt: now }];
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(0);
  expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  events[0].createdAt = new Date(deadline.getTime() - 18 * DAY);
  expect((await processCommercialLifecycle(now)).notificationsCreated).toBe(1);
});
it("noncanonical grace legacy mapping blocks rather than guessing", async () => {
  rows[0] = base("sub", { status: "GRACE_PERIOD", graceEndsAt: now });
  events = [{ subscriptionId: "sub", eventKey: "trial.suspended", createdAt: now }];
  expect((await processCommercialLifecycle(now)).blocked).toBe(1);
  expect(tx.subscription.updateMany).not.toHaveBeenCalled();
});
it("cancellation needs a known elapsed period and has precedence even in PAST_DUE", async () => {
  rows[0] = base("sub", { status: "ACTIVE", cancelAtPeriodEnd: true });
  expect((await processCommercialLifecycle(now)).transitioned).toBe(0);
  Object.assign(rows[0], { status: "PAST_DUE", pastDueEndsAt: now, currentPeriodEndsAt: now });
  expect((await processCommercialLifecycle(now)).transitioned).toBe(1);
  expect(rows[0].status).toBe("CANCELLED");
  expect(events[0].eventKey).toBe(key("cancellation.effective", now));
  await processCommercialLifecycle(now);
  expect(events).toHaveLength(1);
});
it("candidate predicates include reminder windows and exclude terminal cancellation", async () => {
  await processCommercialLifecycle(now);
  const where = (prisma.subscription.findMany as jest.Mock).mock.calls[0][0].where;
  expect(where.OR).toEqual([
    { status: "TRIALING", trialEndsAt: { lte: new Date(now.getTime() + 14 * DAY) } },
    { status: "GRACE_PERIOD", graceEndsAt: { lte: new Date(now.getTime() + DAY) } },
    { status: "PAST_DUE", pastDueEndsAt: { lte: new Date(now.getTime() + DAY) } },
    { status: { not: "CANCELLED" }, cancelAtPeriodEnd: true, currentPeriodEndsAt: { lte: now } },
  ]);
});
