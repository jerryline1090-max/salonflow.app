jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { writeAuditLog } from "../../../core/auditLog";
import { setStaffStatus } from "../staffLifecycle";
import { buildStaff, buildAppointment } from "../../../test-utils/factories";

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("setStaffStatus", () => {
  it("removing a staff member with upcoming appointments raises them for the owner instead of deleting them", async () => {
    const staff = buildStaff({ id: "staff_1", status: "ACTIVE", name: "Ada" });
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(staff);
    (prisma.staff.update as jest.Mock).mockResolvedValue({ ...staff, status: "REMOVED" });
    const upcoming = [buildAppointment({ id: "appt_1" }), buildAppointment({ id: "appt_2" })];
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue(upcoming);

    const result = await setStaffStatus({ staffId: "staff_1", newStatus: "REMOVED", actorUserId: "user_1" });

    // Nothing in this flow ever deletes or cancels the affected appointments.
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.appointment.delete).not.toHaveBeenCalled();

    expect(eventBus.emit).toHaveBeenCalledWith(
      "staff.removed",
      staff.businessId,
      expect.objectContaining({
        staffId: "staff_1",
        staffName: "Ada",
        affectedCount: 2,
        affectedAppointmentIds: ["appt_1", "appt_2"],
      })
    );
    expect(result.affectedAppointments).toHaveLength(2);
  });

  it("does not raise a staff.removed event when there are no upcoming appointments to reassign", async () => {
    const staff = buildStaff({ id: "staff_1" });
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(staff);
    (prisma.staff.update as jest.Mock).mockResolvedValue({ ...staff, status: "REMOVED" });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await setStaffStatus({ staffId: "staff_1", newStatus: "REMOVED", actorUserId: "user_1" });

    expect(eventBus.emit).not.toHaveBeenCalledWith("staff.removed", expect.anything(), expect.anything());
  });

  it("reactivating a staff member emits staff.reactivated and reports no affected appointments", async () => {
    const staff = buildStaff({ id: "staff_1", status: "INACTIVE" });
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(staff);
    (prisma.staff.update as jest.Mock).mockResolvedValue({ ...staff, status: "ACTIVE" });

    const result = await setStaffStatus({ staffId: "staff_1", newStatus: "ACTIVE", actorUserId: "user_1" });

    expect(eventBus.emit).toHaveBeenCalledWith("staff.reactivated", staff.businessId, { staffId: "staff_1" });
    expect(result.affectedAppointments).toEqual([]);
  });

  it("records an audit log entry with the previous and new status", async () => {
    const staff = buildStaff({ id: "staff_1", status: "ACTIVE" });
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(staff);
    (prisma.staff.update as jest.Mock).mockResolvedValue({ ...staff, status: "INACTIVE" });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    await setStaffStatus({ staffId: "staff_1", newStatus: "INACTIVE", actorUserId: "user_1" });

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "staff",
        resourceId: "staff_1",
        action: "status_change",
        previousValue: { status: "ACTIVE" },
        newValue: { status: "INACTIVE" },
      })
    );
  });
});
