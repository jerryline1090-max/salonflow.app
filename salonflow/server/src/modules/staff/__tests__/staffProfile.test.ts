jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { writeAuditLog } from "../../../core/auditLog";
import { createStaffProfile, updateStaffProfile, setStaffSchedule, setStaffServices } from "../staffProfile";
import { buildStaff, buildService } from "../../../test-utils/factories";

beforeEach(() => {
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("createStaffProfile", () => {
  it("rejects linking a User account that belongs to a different business", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user_1", businessId: "other_biz" });

    await expect(
      createStaffProfile({ businessId: "biz_1", name: "Ada", userId: "user_1", actorUserId: "owner_1" })
    ).rejects.toThrow(/not found/i);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it("rejects linking to services that don't belong to this business (or don't exist)", async () => {
    (prisma.service.findMany as jest.Mock).mockResolvedValue([]); // none matched

    await expect(
      createStaffProfile({ businessId: "biz_1", name: "Ada", serviceIds: ["svc_x", "svc_y"], actorUserId: "owner_1" })
    ).rejects.toThrow(/not found/i);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it("creates the staff profile with schedule and service links, and audits it", async () => {
    (prisma.service.findMany as jest.Mock).mockResolvedValue([buildService({ id: "svc_1" })]);
    const created = buildStaff({ id: "staff_new" });
    (prisma.staff.create as jest.Mock).mockResolvedValue(created);

    const result = await createStaffProfile({
      businessId: "biz_1",
      name: "Ada",
      skills: ["braiding"],
      homeServiceEligible: true,
      serviceIds: ["svc_1"],
      schedule: [{ dayOfWeek: 3, startTime: "09:00", endTime: "18:00" }],
      actorUserId: "owner_1",
    });

    expect(result).toBe(created);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ resource: "staff", action: "create_profile" }));
  });
});

describe("updateStaffProfile", () => {
  it("rejects updating a staff profile from a different business", async () => {
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "other_biz" }));

    await expect(
      updateStaffProfile({ staffId: "staff_1", businessId: "biz_1", actorUserId: "owner_1", updates: { name: "New Name" } })
    ).rejects.toThrow(/not found/i);
  });

  it("applies the update and logs previous/new values", async () => {
    const existing = buildStaff({ businessId: "biz_1", name: "Ada" });
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.staff.update as jest.Mock).mockResolvedValue({ ...existing, name: "Ada B." });

    const updated = await updateStaffProfile({ staffId: "staff_1", businessId: "biz_1", actorUserId: "owner_1", updates: { name: "Ada B." } });

    expect(updated.name).toBe("Ada B.");
  });
});

describe("setStaffSchedule", () => {
  it("rejects setting a schedule for a staff member in a different business", async () => {
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "other_biz" }));

    await expect(
      setStaffSchedule({ staffId: "staff_1", businessId: "biz_1", actorUserId: "owner_1", schedule: [] })
    ).rejects.toThrow(/not found/i);
  });

  it("upserts each day of the provided schedule in a single transaction", async () => {
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "biz_1" }));
    (prisma.$transaction as jest.Mock).mockResolvedValue([]);
    (prisma.staffSchedule.findMany as jest.Mock).mockResolvedValue([]);

    await setStaffSchedule({
      staffId: "staff_1",
      businessId: "biz_1",
      actorUserId: "owner_1",
      schedule: [
        { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
        { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    const upsertCalls = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    expect(upsertCalls).toHaveLength(2);
  });
});

describe("setStaffServices", () => {
  it("rejects when one of the requested services doesn't belong to this business", async () => {
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "biz_1" }));
    (prisma.service.findMany as jest.Mock).mockResolvedValue([buildService({ id: "svc_1" })]); // only one of two matched

    await expect(
      setStaffServices({ staffId: "staff_1", businessId: "biz_1", actorUserId: "owner_1", serviceIds: ["svc_1", "svc_2"] })
    ).rejects.toThrow(/not found/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("replaces the staff member's service links atomically", async () => {
    (prisma.staff.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildStaff({ businessId: "biz_1" }));
    (prisma.service.findMany as jest.Mock).mockResolvedValue([buildService({ id: "svc_1" })]);
    (prisma.$transaction as jest.Mock).mockResolvedValue([]);
    (prisma.staffService.findMany as jest.Mock).mockResolvedValue([{ serviceId: "svc_1" }]);

    await setStaffServices({ staffId: "staff_1", businessId: "biz_1", actorUserId: "owner_1", serviceIds: ["svc_1"] });

    expect(prisma.staffService.deleteMany).toHaveBeenCalledWith({ where: { staffId: "staff_1" } });
    expect(prisma.staffService.createMany).toHaveBeenCalledWith({ data: [{ staffId: "staff_1", serviceId: "svc_1" }] });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
