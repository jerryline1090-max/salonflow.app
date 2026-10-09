/** Explicit test-only opt-in. TEST_DATABASE_URL must pass the fixed disposable
 * identity gate before Prisma initialization. No runtime URL fallback.
 * No migrations, existing-row changes, provider calls, or broad cleanup.
 */
jest.mock("../../../lib/prisma", () => {
  const { initializePostgresHarness } = jest.requireActual("./postgresHarnessGuard");
  const { PrismaClient } = jest.requireActual("@prisma/client");
  return { prisma: initializePostgresHarness(process.env, (url: string) =>
    new PrismaClient({ log: [], datasources: { db: { url } } })) };
});
jest.mock("../../../core/eventBus", () => ({ eventBus: { emit: jest.fn().mockResolvedValue(undefined) } }));
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { createAppointment, rescheduleAppointment, changeAppointmentStatus } from "../appointmentService";
import { shiftCalendarDay, zonedParts, zonedDateTimeToUtc } from "../../../core/timezone";
import { postgresHarnessUrl } from "./postgresHarnessGuard";

const enabled = postgresHarnessUrl(process.env) !== undefined;
const suite = enabled ? describe : describe.skip;
suite("real PostgreSQL appointment concurrency (explicit disposable opt-in)", () => {
  jest.setTimeout(300_000);
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => { jest.restoreAllMocks(); await prisma.$disconnect(); });

  it("proves all seven races with committed counts; stops on first failure", async () => {
    const actor = { type: "SYSTEM" as const };
    const baseDay = shiftCalendarDay(zonedParts(new Date(), "Africa/Lagos"), 1);
    const at = (hour: number, minute = 0) => zonedDateTimeToUtc({ ...baseDay, hour, minute }, "Africa/Lagos");
    const originalTransaction = prisma.$transaction.bind(prisma);

    for (const scenario of ["same-slot", "overlap", "buffer-boundary", "reschedule", "create-vs-reschedule", "status", "retry-idempotency"]) {
      const businessId = `phase4c_${randomUUID()}`;
      const staffId = randomUUID(), serviceId = randomUUID(), clientId = randomUUID();
      let stage = "fixture";
      try {
        await prisma.business.create({ data: {
          id: businessId, name: "Disposable appointment concurrency fixture", timezone: "Africa/Lagos", mode: "SALON_ONLY",
          minBookingNoticeMins: 0, maxBookingHorizonDays: 30,
          workingHours: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, openTime: "09:00", closeTime: "18:00" })) },
          clients: { create: { id: clientId, name: "Synthetic client" } },
          services: { create: { id: serviceId, name: "Synthetic service", durationMinutes: 60, bufferMinutes: 15, price: 100 } },
          staff: { create: { id: staffId, name: "Synthetic staff", schedule: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "18:00" })) } } },
        } });
        await prisma.staffService.create({ data: { staffId, serviceId } });
        const create = (startsAt: Date) => createAppointment({ businessId, staffId, serviceId, clientId, startsAt, locationType: "SALON", bookingChannel: "DASHBOARD", actor });
        const baseline: string[] = [];
        if (["reschedule", "create-vs-reschedule", "status"].includes(scenario)) baseline.push((await create(at(9))).id);
        if (scenario === "reschedule") baseline.push((await create(at(11))).id);

        let attempts = 0, p2034 = 0, arrivals = 0;
        let release!: () => void;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        let barrierTimer: ReturnType<typeof setTimeout> | undefined;
        const gate = async () => {
          if (++arrivals > 2) return;
          if (arrivals === 2) { clearTimeout(barrierTimer); release(); }
          else barrierTimer = setTimeout(release, 6_000);
          await barrier;
        };
        // Instrument, but do not emulate, Prisma transactions. Both real
        // connections finish their conflict/current-state read before writes.
        const transactionSpy = jest.spyOn(prisma, "$transaction").mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: any) => {
          attempts++;
          expect(options.isolationLevel).toBe("Serializable");
          try {
            return await originalTransaction(async tx => {
              const delegate = new Proxy(tx.appointment, { get(target, key) {
                if (key === (scenario === "status" ? "findUniqueOrThrow" : "findMany")) {
                  return async (args: any) => {
                    const value = await (target[key as keyof typeof target] as any).call(target, args);
                    await gate();
                    return value;
                  };
                }
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              } });
              const observed = new Proxy(tx, { get(target, key) {
                if (key === "appointment") return delegate;
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              } });
              return work(observed);
            }, options);
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") p2034++;
            throw error;
          }
        }) as any);
        stage = "race";
        let operations: Promise<unknown>[];
        if (scenario === "reschedule") operations = baseline.map(appointmentId => rescheduleAppointment({ appointmentId, newStartsAt: at(14), actor }));
        else if (scenario === "create-vs-reschedule") operations = [create(at(14)), rescheduleAppointment({ appointmentId: baseline[0], newStartsAt: at(14), actor })];
        else if (scenario === "status") operations = [changeAppointmentStatus({ appointmentId: baseline[0], newStatus: "COMPLETED", actor }), changeAppointmentStatus({ appointmentId: baseline[0], newStatus: "CANCELLED", actor })];
        else operations = [create(at(9)), create(scenario === "overlap" ? at(9, 30) : scenario === "buffer-boundary" ? at(10, 15) : at(9))];
        const results = await Promise.allSettled(operations);
        clearTimeout(barrierTimer);
        transactionSpy.mockRestore();
        const successes = results.filter(r => r.status === "fulfilled").length;
        const conflicts = results.filter(r => r.status === "rejected" && r.reason?.statusCode === 409).length;
        const failures = results.filter(r => r.status === "rejected" && r.reason?.statusCode !== 409).map(r => {
          const e = (r as PromiseRejectedResult).reason;
          return { name: e?.name, code: e?.code ?? null };
        });
        stage = "counts";
        const rows = await prisma.appointment.findMany({ where: { businessId }, select: { startsAt: true, endsAt: true, status: true } });
        const events = await prisma.appointmentEvent.count({ where: { appointment: { businessId } } });
        const audits = await prisma.auditLog.count({ where: { businessId, resource: "appointment" } });
        const successesExpected = scenario === "buffer-boundary" ? 2 : 1;
        const appointmentsExpected = scenario === "reschedule" ? 2 : scenario === "create-vs-reschedule" ? (results[0].status === "fulfilled" ? 2 : 1) : scenario === "buffer-boundary" ? 2 : 1;
        console.log(JSON.stringify({ scenario, successes, conflicts, failures, transactionAttempts: attempts, p2034, appointments: rows.length, appointmentEvents: events, auditRows: audits }));
        expect(failures).toEqual([]);
        expect(successes).toBe(successesExpected);
        expect(conflicts).toBe(2 - successesExpected);
        expect(rows).toHaveLength(appointmentsExpected);
        expect(events).toBe(baseline.length + successesExpected);
        expect(audits).toBe(baseline.length + successesExpected);
        const occupied = rows.filter(r => r.status === "PENDING" || r.status === "CONFIRMED").sort((a,b) => +a.startsAt - +b.startsAt);
        for (let i=1; i<occupied.length; i++) expect(+occupied[i].startsAt).toBeGreaterThanOrEqual(+occupied[i-1].endsAt);
        if (scenario === "status") expect(["COMPLETED", "CANCELLED"]).toContain(rows[0].status);
        if (scenario === "retry-idempotency") { expect(p2034).toBeGreaterThanOrEqual(1); expect(attempts).toBeGreaterThanOrEqual(3); }
      } catch (error) {
        jest.restoreAllMocks();
        if (error instanceof Prisma.PrismaClientKnownRequestError) throw new Error(`Disposable concurrency check stopped: ${scenario}/${stage}/${error.code}`);
        throw error;
      }
    }
    // Retained isolated fixtures: no pre-existing cleanup harness exists.
    // Never truncate or delete pre-existing data as part of this opt-in run.
  });
});
