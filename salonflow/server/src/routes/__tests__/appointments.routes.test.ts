jest.mock("../../lib/prisma");
jest.mock("../../modules/appointments/appointmentService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { appointmentsRouter } from "../appointments.routes";
import { signTokenForCurrentUser as signToken } from "../../test-utils/authenticatedUser";
import { reassignAppointmentStaff, acknowledgeAttention, rescheduleAppointment } from "../../modules/appointments/appointmentService";
import { buildAppointment } from "../../test-utils/factories";
import { AppointmentConflictError } from "../../modules/appointments/appointmentTransaction";
import { staffRouter } from "../staff.routes";
import { settingsRouter } from "../settings.routes";
import { errorHandler } from "../../middleware/errorHandler";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/staff", staffRouter);
  app.use("/api/settings", settingsRouter);
  app.use(errorHandler);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_user_1", businessId: "biz_1", role: "STAFF" });
const otherBusinessOwnerToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });
const managerToken = signToken({ sub: "manager_1", businessId: "biz_1", role: "MANAGER" });

beforeEach(() => {
  // No per-user permission overrides in these tests — role defaults apply.
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("R8 complete authorized calendar reads", () => {
  const hours = [{ dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isClosed: false }];
  it.each([["OWNER", ownerToken, true], ["MANAGER", managerToken, true], ["STAFF", staffToken, false]] as const)("%s receives only safe authenticated-business display context", async (_role, token, canManage) => {
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ timezone: "Africa/Lagos", workingHours: hours, secret: "must-not-leak" });
    const res = await request(buildApp()).get("/api/appointments/calendar-context?businessId=biz_2").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ timezone: "Africa/Lagos", workingHours: hours, canCreate: canManage, canViewStaff: canManage });
    expect(prisma.business.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "biz_1" }, select: { timezone: true, workingHours: { select: { dayOfWeek: true, openTime: true, closeTime: true, isClosed: true } } } });
    expect(prisma.staff.findMany).not.toHaveBeenCalled();
  });

  it("STAFF calendar works while directory/settings remain forbidden; another staff query cannot widen scope", async () => {
    (prisma.business.findUniqueOrThrow as jest.Mock).mockResolvedValue({ timezone: "Africa/Lagos", workingHours: hours });
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff_1" });
    const all = [buildAppointment({ id: "own", staffId: "staff_1" }), buildAppointment({ id: "other", staffId: "staff_2" }), buildAppointment({ id: "foreign", businessId: "biz_2", staffId: "staff_1" })];
    (prisma.appointment.findMany as jest.Mock).mockImplementation(async ({ where }) => all.filter(a => a.businessId === where.businessId && a.staffId === where.staffId));
    (prisma.appointment.count as jest.Mock).mockResolvedValue(1);
    const app = buildApp();
    for (const path of ["/api/staff", "/api/settings"]) {
      expect((await request(app).get(path).set("Authorization", `Bearer ${staffToken}`)).status).toBe(403);
    }
    expect((await request(app).get("/api/appointments/calendar-context").set("Authorization", `Bearer ${staffToken}`)).status).toBe(200);
    const res = await request(app).get("/api/appointments?staffId=staff_2&businessId=biz_2&from=2026-08-25T23:00:00Z&to=2026-08-26T22:59:59.999Z").set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((a: any) => a.id)).toEqual(["own"]);
    expect(prisma.appointment.count).toHaveBeenCalledWith({ where: expect.objectContaining({ businessId: "biz_1", staffId: "staff_1" }) });
  });

  it.each([["OWNER", ownerToken], ["MANAGER", managerToken]] as const)("%s can retrieve all 150 authorized appointments through bounded pages", async (_role, token) => {
    const rows = Array.from({ length: 150 }, (_, i) => buildAppointment({ id: `range_${i}` }));
    (prisma.appointment.findMany as jest.Mock).mockImplementation(async ({ skip, take }) => rows.slice(skip, skip + take));
    (prisma.appointment.count as jest.Mock).mockResolvedValue(150);
    const received: any[] = [];
    for (const page of [1, 2]) {
      const res = await request(buildApp()).get(`/api/appointments?page=${page}&limit=100&from=2026-08-25T23:00:00Z&to=2026-08-26T22:59:59.999Z`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual({ page, limit: 100, total: 150, totalPages: 2 });
      received.push(...res.body.items);
    }
    expect(received).toHaveLength(150);
    for (const [args] of (prisma.appointment.findMany as jest.Mock).mock.calls) {
      expect(args.where).toEqual({ businessId: "biz_1", startsAt: { gte: new Date("2026-08-25T23:00:00Z"), lte: new Date("2026-08-26T22:59:59.999Z") } });
      expect(args.orderBy).toEqual([{ startsAt: "asc" }, { id: "asc" }]);
    }
  });

  it("calendar context respects an explicit appointments:view denial", async () => {
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue({ canView: false });
    const res = await request(buildApp()).get("/api/appointments/calendar-context").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
    expect(prisma.business.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("GET /api/appointments/calendar-range snapshot", () => {
  const bounds = "from=2026-08-25T23:00:00.000Z&to=2026-08-26T22:59:59.999Z";
  let tx: { appointment: { findMany: jest.Mock }; staff: { findUnique: jest.Mock } };
  beforeEach(() => {
    tx = { appointment: { findMany: jest.fn().mockResolvedValue([]) }, staff: { findUnique: jest.fn().mockResolvedValue({ id: "staff_1", businessId: "biz_1" }) } };
    (prisma.$transaction as jest.Mock).mockImplementation(async work => work(tx));
  });

  it.each([["OWNER", ownerToken], ["MANAGER", managerToken]] as const)("%s receives all 150 rows through one RepeatableRead transaction and one appointment retrieval", async (_role, token) => {
    tx.appointment.findMany.mockResolvedValue(Array.from({ length: 150 }, (_, i) => buildAppointment({ id: `snapshot_${i}` })));
    const res = await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}&businessId=biz_2&page=2&limit=25`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(150);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 });
    expect(tx.appointment.findMany).toHaveBeenCalledTimes(1);
    const query = tx.appointment.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ businessId: "biz_1", startsAt: { gte: new Date("2026-08-25T23:00:00.000Z"), lte: new Date("2026-08-26T22:59:59.999Z") } });
    expect(query.take).toBe(1001);
    expect(query.skip).toBeUndefined();
    expect(query.orderBy).toEqual([{ startsAt: "asc" }, { id: "asc" }]);
    expect(query.include).toEqual({ client: { select: { id: true, name: true, phone: true, email: true } }, service: { select: { id: true, name: true, price: true, durationMinutes: true } }, staff: { select: { id: true, name: true } } });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(prisma.appointment.count).not.toHaveBeenCalled();
  });

  it("STAFF linkage and appointments are read in the same snapshot; hostile staff/business filters cannot widen scope", async () => {
    const rows = [buildAppointment({ id: "own", staffId: "staff_1" }), buildAppointment({ id: "other", staffId: "staff_2" }), buildAppointment({ id: "foreign", businessId: "biz_2", staffId: "staff_1" })];
    tx.appointment.findMany.mockImplementation(async ({ where }) => rows.filter(a => a.businessId === where.businessId && a.staffId === where.staffId));
    const res = await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}&staffId=staff_2&businessId=biz_2`).set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: any) => a.id)).toEqual(["own"]);
    expect(tx.staff.findUnique).toHaveBeenCalledWith({ where: { userId: "staff_user_1" }, select: { id: true, businessId: true } });
    expect(tx.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz_1", staffId: "staff_1" }) }));
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, { id: "foreign", businessId: "biz_2" }])("missing or foreign STAFF linkage returns no appointments", async linked => {
    tx.staff.findUnique.mockResolvedValue(linked);
    const res = await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}`).set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(tx.appointment.findMany).not.toHaveBeenCalled();
  });

  it("OWNER staff filter remains tenant-scoped", async () => {
    await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}&staffId=staff_2`).set("Authorization", `Bearer ${ownerToken}`);
    expect(tx.appointment.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ businessId: "biz_1", staffId: "staff_2" }));
  });

  it.each(["", "from=2026-08-01", "to=2026-08-01", "from=bad&to=bad", "from=2026-08-02&to=2026-08-01", "from=2026-08-01&to=2026-09-03", "from[]=2026-08-01&to=2026-08-02"])("rejects invalid/unbounded range before database retrieval: %s", query => {
    return request(buildApp()).get(`/api/appointments/calendar-range?${query}`).set("Authorization", `Bearer ${ownerToken}`).then(res => {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CALENDAR_RANGE");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it("accepts exactly 32 days and an empty complete result", async () => {
    const res = await request(buildApp()).get("/api/appointments/calendar-range?from=2026-08-01T00:00:00Z&to=2026-09-02T00:00:00Z").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each([1000, 1001])("handles the hard-cap boundary without truncation: %s rows", async count => {
    tx.appointment.findMany.mockResolvedValue(Array.from({ length: count }, (_, i) => ({ id: `cap_${i}` })));
    const res = await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(count === 1000 ? 200 : 422);
    if (count === 1000) expect(res.body).toHaveLength(1000);
    else { expect(res.body.code).toBe("CALENDAR_RANGE_TOO_LARGE"); expect(res.body.items).toBeUndefined(); expect(Array.isArray(res.body)).toBe(false); }
  });

  it("a failed read transaction returns an error, not appointment data", async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error("fixture failure"));
    const res = await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("requires authentication and appointments:view", async () => {
    expect((await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}`)).status).toBe(401);
    (prisma.permission.findUnique as jest.Mock).mockResolvedValue({ canView: false });
    expect((await request(buildApp()).get(`/api/appointments/calendar-range?${bounds}`).set("Authorization", `Bearer ${staffToken}`)).status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

it("returns a safe 409 for a stale reschedule instead of database details", async () => {
  (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment());
  (rescheduleAppointment as jest.Mock).mockRejectedValue(new AppointmentConflictError());
  const res = await request(buildApp()).post("/api/appointments/appt_1/reschedule").set("Authorization", `Bearer ${ownerToken}`).send({ newStartsAt: "2026-08-26T10:00:00Z" });
  expect(res.status).toBe(409);
  expect(res.body).toEqual({ error: "This time is no longer available. Please refresh and try again." });
});

describe("GET /api/appointments", () => {
  it("401s with no Authorization header", async () => {
    const res = await request(buildApp()).get("/api/appointments");
    expect(res.status).toBe(401);
  });

  it("an OWNER sees every appointment in their own business, unscoped by staff", async () => {
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([buildAppointment()]);

    const res = await request(buildApp()).get("/api/appointments").set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg).toEqual({ businessId: "biz_1" });
  });

  it("a STAFF user only ever sees appointments scoped to their own linked staff profile", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff_1" });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/appointments").set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg).toEqual({ businessId: "biz_1", staffId: "staff_1" });
  });

  it("a STAFF user with no linked Staff profile sees nothing rather than everything", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp()).get("/api/appointments").set("Authorization", `Bearer ${staffToken}`);

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.staffId).toBe("__none__");
  });

  it("filters by status, needsAttention, and date range via query params for an OWNER", async () => {
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp())
      .get("/api/appointments?status=PENDING&needsAttention=true&from=2026-08-01&to=2026-08-31")
      .set("Authorization", `Bearer ${ownerToken}`);

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.status).toBe("PENDING");
    expect(whereArg.needsAttention).toBe(true);
    expect(whereArg.startsAt.gte).toEqual(new Date("2026-08-01"));
    expect(whereArg.startsAt.lte).toEqual(new Date("2026-08-31"));
  });

  it("a staffId query param is ignored for a STAFF actor — their own scoping always wins", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff_1" });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await request(buildApp())
      .get("/api/appointments?staffId=someone_else")
      .set("Authorization", `Bearer ${staffToken}`);

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.staffId).toBe("staff_1");
  });

  it("caps list size and returns deterministic pagination metadata", async () => {
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.appointment.count as jest.Mock).mockResolvedValue(3);
    const res = await request(buildApp()).get("/api/appointments?limit=500").set("Authorization", `Bearer ${ownerToken}`);
    expect((prisma.appointment.findMany as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({ take: 100, skip: 0, orderBy: [{ startsAt: "asc" }, { id: "asc" }] }));
    expect(res.body.pagination).toEqual({ page: 1, limit: 100, total: 3, totalPages: 1 });
  });
});

describe("GET /api/appointments/:id", () => {
  it("403s when the appointment belongs to a different business, even for a valid OWNER token", async () => {
    (prisma.appointment.findUnique as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1" }));

    const res = await request(buildApp())
      .get("/api/appointments/appt_1")
      .set("Authorization", `Bearer ${otherBusinessOwnerToken}`);

    expect(res.status).toBe(403);
  });

  it("403s a STAFF user viewing another staff member's appointment", async () => {
    (prisma.appointment.findUnique as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1", staffId: "someone_else" }));
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff_1" });

    const res = await request(buildApp()).get("/api/appointments/appt_1").set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/appointments/:id/acknowledge-attention", () => {
  it("lets an OWNER keep a flagged appointment pending", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1" }));
    (acknowledgeAttention as jest.Mock).mockResolvedValue(buildAppointment({ needsAttention: false }));

    const res = await request(buildApp())
      .post("/api/appointments/appt_1/acknowledge-attention")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(acknowledgeAttention).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "appt_1", actor: { type: "USER", userId: "owner_1" } })
    );
  });

  it("403s across businesses", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1" }));

    const res = await request(buildApp())
      .post("/api/appointments/appt_1/acknowledge-attention")
      .set("Authorization", `Bearer ${otherBusinessOwnerToken}`);

    expect(res.status).toBe(403);
    expect(acknowledgeAttention).not.toHaveBeenCalled();
  });
});

describe("POST /api/appointments/:id/reschedule", () => {
  it("403s a STAFF user attempting to reschedule another staff member's appointment", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1", staffId: "someone_else" }));
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff_1" });

    const res = await request(buildApp())
      .post("/api/appointments/appt_1/reschedule")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ newStartsAt: "2026-08-26T16:00:00.000Z" });

    expect(res.status).toBe(403);
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });
});

describe("POST /api/appointments/:id/reassign", () => {
  it("403s for a STAFF role regardless of the 'edit' permission — reassignment is owner/manager-only", async () => {
    const res = await request(buildApp())
      .post("/api/appointments/appt_1/reassign")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ newStaffId: "staff_2" });

    expect(res.status).toBe(403);
    expect(reassignAppointmentStaff).not.toHaveBeenCalled();
  });

  it("allows an OWNER to reassign an appointment within their own business", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1" }));
    (reassignAppointmentStaff as jest.Mock).mockResolvedValue(buildAppointment({ staffId: "staff_2" }));

    const res = await request(buildApp())
      .post("/api/appointments/appt_1/reassign")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ newStaffId: "staff_2", reason: "Ada is unavailable" });

    expect(res.status).toBe(200);
    expect(reassignAppointmentStaff).toHaveBeenCalledWith(
      expect.objectContaining({ newStaffId: "staff_2", actor: { type: "USER", userId: "owner_1" } })
    );
  });

  it("403s an OWNER trying to reassign an appointment that belongs to a different business", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1" }));

    const res = await request(buildApp())
      .post("/api/appointments/appt_1/reassign")
      .set("Authorization", `Bearer ${otherBusinessOwnerToken}`)
      .send({ newStaffId: "staff_2" });

    expect(res.status).toBe(403);
    expect(reassignAppointmentStaff).not.toHaveBeenCalled();
  });
});
