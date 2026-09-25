jest.mock("../../../lib/prisma");
jest.mock("../../staff/resolveOwnStaffId");
jest.mock("../../appointments/appointmentService");
jest.mock("../../reports/reportService");

import { prisma } from "../../../lib/prisma";
import { PermissionDeniedError } from "../../../core/permissions";
import { resolveOwnStaffId } from "../../staff/resolveOwnStaffId";
import { rescheduleAppointment, reassignAppointmentStaff } from "../../appointments/appointmentService";
import { getRevenueReport as getRevenueReportService } from "../../reports/reportService";
import {
  searchAppointments,
  getAppointment,
  moveAppointment,
  reassignAppointmentTool,
  getRevenueReport,
  getClientCount,
} from "../assistantTools";
import { buildAppointment } from "../../../test-utils/factories";

const ownerActor = { userId: "owner_1", role: "OWNER" as const, businessId: "biz_1" };
const staffActor = { userId: "staff_user_1", role: "STAFF" as const, businessId: "biz_1" };

beforeEach(() => {
  (prisma.permission.findUnique as jest.Mock).mockResolvedValue(null);
});

describe("permission inheritance (section 27 hard rule)", () => {
  it("a STAFF actor cannot call getRevenueReport - same denial the dashboard would give them", async () => {
    await expect(getRevenueReport(staffActor, new Date(), new Date())).rejects.toThrow(PermissionDeniedError);
    expect(getRevenueReportService).not.toHaveBeenCalled();
  });

  it("an OWNER actor can call getRevenueReport", async () => {
    (getRevenueReportService as jest.Mock).mockResolvedValue({ totalRevenue: 500000 });

    const result = await getRevenueReport(ownerActor, new Date("2026-08-01"), new Date("2026-08-31"));

    expect(result).toEqual({ totalRevenue: 500000 });
    expect(getRevenueReportService).toHaveBeenCalledWith("biz_1", expect.any(Date), expect.any(Date));
  });

  it("clients:view is in STAFF's default set, so a plain count still succeeds — the boundary isn't 'STAFF can never do anything'", async () => {
    (prisma.client.count as jest.Mock).mockResolvedValue(42);
    const count = await getClientCount(staffActor);
    expect(count).toBe(42);
  });
});

describe("STAFF ownership scoping - mirrors the REST layer exactly", () => {
  it("searchAppointments scopes results to the STAFF actor's own linked staff profile", async () => {
    (resolveOwnStaffId as jest.Mock).mockResolvedValue("staff_1");
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await searchAppointments(staffActor, {});

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.staffId).toBe("staff_1");
  });

  it("a STAFF actor with no linked staff profile sees nothing, not everything", async () => {
    (resolveOwnStaffId as jest.Mock).mockResolvedValue(null);
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await searchAppointments(staffActor, {});

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.staffId).toBe("__none__");
  });

  it("an OWNER actor's search is not staff-scoped at all", async () => {
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await searchAppointments(ownerActor, {});

    const whereArg = (prisma.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.staffId).toBeUndefined();
  });

  it("blocks a STAFF actor from getting another staff member's appointment", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "biz_1", staffId: "someone_else" })
    );
    (resolveOwnStaffId as jest.Mock).mockResolvedValue("staff_1");

    await expect(getAppointment(staffActor, "appt_1")).rejects.toThrow(/different staff member/i);
  });

  it("blocks a STAFF actor from moving another staff member's appointment", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      buildAppointment({ businessId: "biz_1", staffId: "someone_else" })
    );
    (resolveOwnStaffId as jest.Mock).mockResolvedValue("staff_1");

    await expect(moveAppointment(staffActor, "appt_1", new Date())).rejects.toThrow(/different staff member/i);
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });

  it("allows a STAFF actor to move their own appointment", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1", staffId: "staff_1" }));
    (resolveOwnStaffId as jest.Mock).mockResolvedValue("staff_1");
    (rescheduleAppointment as jest.Mock).mockResolvedValue(buildAppointment());

    await moveAppointment(staffActor, "appt_1", new Date());

    expect(rescheduleAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "appt_1", actor: { type: "AI", userId: "staff_user_1" } })
    );
  });
});

describe("reassignment stays owner/manager-only, mirroring the REST layer's explicit block", () => {
  it("blocks a STAFF actor from reassigning even though STAFF has 'edit' on appointments by default", async () => {
    await expect(reassignAppointmentTool(staffActor, "appt_1", "staff_2")).rejects.toThrow(/only an owner or manager/i);
    expect(reassignAppointmentStaff).not.toHaveBeenCalled();
  });

  it("allows an OWNER actor to reassign", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "biz_1" }));
    (reassignAppointmentStaff as jest.Mock).mockResolvedValue(buildAppointment({ staffId: "staff_2" }));

    await reassignAppointmentTool(ownerActor, "appt_1", "staff_2", "Ada is unavailable");

    expect(reassignAppointmentStaff).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "appt_1", newStaffId: "staff_2", actor: { type: "AI", userId: "owner_1" } })
    );
  });
});

describe("tenant scoping", () => {
  it("rejects acting on an appointment from a different business even for an OWNER", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ businessId: "other_biz" }));

    await expect(getAppointment(ownerActor, "appt_1")).rejects.toThrow(/not found/i);
  });
});
