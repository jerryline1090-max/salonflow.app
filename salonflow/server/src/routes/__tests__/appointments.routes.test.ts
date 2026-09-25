jest.mock("../../lib/prisma");
jest.mock("../../modules/appointments/appointmentService");

import express from "express";
import request from "supertest";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { appointmentsRouter } from "../appointments.routes";
import { signToken } from "../../core/auth";
import { reassignAppointmentStaff, acknowledgeAttention } from "../../modules/appointments/appointmentService";
import { buildAppointment } from "../../test-utils/factories";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/appointments", appointmentsRouter);
  return app;
}

const ownerToken = signToken({ sub: "owner_1", businessId: "biz_1", role: "OWNER" });
const staffToken = signToken({ sub: "staff_user_1", businessId: "biz_1", role: "STAFF" });
const otherBusinessOwnerToken = signToken({ sub: "owner_2", businessId: "biz_2", role: "OWNER" });

beforeEach(() => {
  // No per-user permission overrides in these tests — role defaults apply.
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
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
