jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { checkStaffAvailability } from "../staffAvailability";
import { buildStaff, buildSchedule, buildBusiness, wednesdayAt } from "../../../test-utils/factories";

describe("checkStaffAvailability", () => {
  it("rejects when the staff member does not exist", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await checkStaffAvailability({
      staffId: "ghost",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "SALON",
    });

    expect(result).toEqual({ available: false, reason: "Staff member not found" });
  });

  it("rejects an inactive or removed staff member", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff({ status: "REMOVED" }));

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/removed/i);
  });

  it("rejects a home-service booking for staff not eligible for home service", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff({ homeServiceEligible: false }));

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "HOME",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not eligible for home service/i);
  });

  it("rejects when the staff member doesn't work that day", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/does not work on this day/i);
  });

  it("rejects a slot outside working hours even on a working day", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule({ startTime: "09:00", endTime: "18:00" }));

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(19),
      endsAt: wednesdayAt(20),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/outside staff working hours/i);
  });

  it("rejects a slot that overlaps approved time off", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule());
    (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue({ id: "off_1" });

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/time off/i);
  });

  it("rejects a plain double-booking at the salon", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule());
    (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([
      { id: "existing_appt", locationType: "SALON", startsAt: wednesdayAt(14), endsAt: wednesdayAt(15), travelBufferMins: 0 },
    ]);

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/already has an appointment/i);
  });

  it("rejects a home visit immediately followed by a salon appointment with no travel time (the Ada scenario)", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule());
    (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness({ homeServiceTravelBufferMins: 30 }));
    // A home appointment 2:00-2:30 PM already exists; a salon slot at 2:30 PM
    // leaves zero travel time, so with a 30-min buffer this must conflict.
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([
      { id: "home_appt", locationType: "HOME", startsAt: wednesdayAt(14), endsAt: wednesdayAt(14, 30), travelBufferMins: 30 },
    ]);

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14, 30),
      endsAt: wednesdayAt(15, 30),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/travel time/i);

  });

  it("uses the appointment's persisted buffer rather than a later business-default change", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule());
    (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness({ homeServiceTravelBufferMins: 10 }));
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([
      { id: "home_appt", locationType: "HOME", startsAt: wednesdayAt(14), endsAt: wednesdayAt(14, 30), travelBufferMins: 45 },
    ]);

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(15),
      endsAt: wednesdayAt(16),
      locationType: "SALON",
    });

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/travel time/i);
  });

  it("returns available when every check passes", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(buildStaff());
    (prisma.staffSchedule.findUnique as jest.Mock).mockResolvedValue(buildSchedule());
    (prisma.staffTimeOff.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    const result = await checkStaffAvailability({
      staffId: "staff_1",
      businessId: "biz_1",
      startsAt: wednesdayAt(14),
      endsAt: wednesdayAt(15),
      locationType: "SALON",
    });

    expect(result).toEqual({ available: true });
  });
});
