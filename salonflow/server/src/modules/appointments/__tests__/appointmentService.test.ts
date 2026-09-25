jest.mock("../../../lib/prisma");
jest.mock("../../staff/staffAvailability");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { writeAuditLog } from "../../../core/auditLog";
import { checkStaffAvailability } from "../../staff/staffAvailability";
import {
  createAppointment,
  changeAppointmentStatus,
  rescheduleAppointment,
  reassignAppointmentStaff,
  acknowledgeAttention,
} from "../appointmentService";
import { InvalidStatusTransitionError } from "../appointmentStateMachine";
import { buildService, buildBusiness, buildAppointment, wednesdayAt } from "../../../test-utils/factories";

const actor = { type: "USER" as const, userId: "user_1" };

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("createAppointment", () => {
  const baseInput = {
    businessId: "biz_1",
    clientId: "client_1",
    serviceId: "svc_1",
    staffId: "staff_1",
    startsAt: wednesdayAt(14),
    locationType: "SALON" as const,
    bookingChannel: "DASHBOARD" as const,
    actor,
  };

  it("rejects when the service doesn't belong to this business", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService({ businessId: "other_biz" }));

    await expect(createAppointment(baseInput)).rejects.toThrow(/service not found/i);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it("rejects a booking for an inactive (retired) service", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService({ isActive: false }));

    await expect(createAppointment(baseInput)).rejects.toThrow(/no longer offered/i);
  });

  it("rejects a home-service booking for a service not offered as home service", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService({ availableAtHome: false }));

    await expect(createAppointment({ ...baseInput, locationType: "HOME" })).rejects.toThrow(/not offered as a home service/i);
  });

  it("rejects a salon booking for a home-only service", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService({ availableAtSalon: false }));

    await expect(createAppointment(baseInput)).rejects.toThrow(/not offered at the salon/i);
  });

  it("rejects the booking when the staff availability check fails", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(buildService());
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness());
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: false, reason: "Staff member is inactive" });

    await expect(createAppointment(baseInput)).rejects.toThrow(/Staff member is inactive/);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it("creates the appointment with a price/duration snapshot and a CREATED history event", async () => {
    const service = buildService();
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(service);
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness());
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: true });
    const created = buildAppointment();
    (prisma.appointment.create as jest.Mock).mockResolvedValue(created);

    const result = await createAppointment(baseInput);

    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceSnapshot: service.price,
          durationSnapshot: service.durationMinutes,
          status: "PENDING",
        }),
      })
    );
    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "CREATED" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "create", resource: "appointment" }));
    expect(eventBus.emit).toHaveBeenCalledWith("appointment.created", "biz_1", expect.objectContaining({ appointment: created }));
    expect(result).toBe(created);
  });

  it("never lets a later service price change affect a past booking's snapshot (regression guard)", async () => {
    const serviceAtBookingTime = buildService({ price: 4_000_000 });
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(serviceAtBookingTime);
    (prisma.business.findUnique as jest.Mock).mockResolvedValue(buildBusiness());
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: true });
    (prisma.appointment.create as jest.Mock).mockResolvedValue(buildAppointment({ priceSnapshot: 4_000_000 }));

    await createAppointment(baseInput);

    const dataArg = (prisma.appointment.create as jest.Mock).mock.calls[0][0].data;
    expect(dataArg.priceSnapshot).toBe(4_000_000);

    // Even if the service price changes moments later, this call already
    // captured the snapshot — nothing re-reads Service.price after this.
    serviceAtBookingTime.price = 5_000_000;
    expect(dataArg.priceSnapshot).toBe(4_000_000);
  });
});

describe("changeAppointmentStatus", () => {
  it("rejects an invalid transition and makes no database write", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ status: "COMPLETED" }));

    await expect(
      changeAppointmentStatus({ appointmentId: "appt_1", newStatus: "PENDING", actor })
    ).rejects.toThrow(InvalidStatusTransitionError);

    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it("marks an appointment completed, clears any attention flag, and emits both events", async () => {
    const existing = buildAppointment({ status: "PENDING", needsAttention: true, attentionReason: "stale" });
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.appointment.update as jest.Mock).mockResolvedValue({ ...existing, status: "COMPLETED", needsAttention: false });

    const result = await changeAppointmentStatus({ appointmentId: "appt_1", newStatus: "COMPLETED", actor });

    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", needsAttention: false }) })
    );
    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "COMPLETED" }) })
    );
    // Because the appointment had needsAttention=true, resolving it also
    // records an ATTENTION_RESOLVED event — the flag doesn't just vanish silently.
    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ATTENTION_RESOLVED" }) })
    );
    expect(eventBus.emit).toHaveBeenCalledWith("appointment.status_changed", "biz_1", expect.anything());
    expect(eventBus.emit).toHaveBeenCalledWith("appointment.completed", "biz_1", expect.anything());
    expect(result.status).toBe("COMPLETED");
  });

  it("emits appointment.cancelled and a CANCELLATION event when cancelled", async () => {
    const existing = buildAppointment({ status: "CONFIRMED" });
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.appointment.update as jest.Mock).mockResolvedValue({ ...existing, status: "CANCELLED" });

    await changeAppointmentStatus({ appointmentId: "appt_1", newStatus: "CANCELLED", actor, reason: "Client requested" });

    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "CANCELLATION", reason: "Client requested" }) })
    );
    expect(eventBus.emit).toHaveBeenCalledWith("appointment.cancelled", "biz_1", expect.anything());
  });
});

describe("rescheduleAppointment", () => {
  it("rejects when the new slot conflicts with the staff member's schedule", async () => {
    const existing = buildAppointment();
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildService());
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: false, reason: "Staff member already has an appointment at this time" });

    await expect(
      rescheduleAppointment({ appointmentId: "appt_1", newStartsAt: wednesdayAt(15), actor })
    ).rejects.toThrow(/already has an appointment/);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it("moves the appointment and records a RESCHEDULED event, excluding itself from the conflict check", async () => {
    const existing = buildAppointment();
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.service.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildService());
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: true });
    (prisma.appointment.update as jest.Mock).mockResolvedValue({ ...existing, startsAt: wednesdayAt(16) });

    await rescheduleAppointment({ appointmentId: "appt_1", newStartsAt: wednesdayAt(16), actor });

    expect(checkStaffAvailability).toHaveBeenCalledWith(expect.objectContaining({ excludeAppointmentId: "appt_1" }));
    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "RESCHEDULED" }) })
    );
    expect(eventBus.emit).toHaveBeenCalledWith("appointment.rescheduled", "biz_1", expect.anything());
  });
});

describe("reassignAppointmentStaff", () => {
  it("rejects reassignment to a staff member who isn't actually available", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment());
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: false, reason: "Staff member is inactive" });

    await expect(
      reassignAppointmentStaff({ appointmentId: "appt_1", newStaffId: "staff_2", actor })
    ).rejects.toThrow(/Staff member is inactive/);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it("reassigns the appointment, records previous/new staff, and emits a reassignment event with the reason", async () => {
    const existing = buildAppointment({ staffId: "staff_1" });
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (checkStaffAvailability as jest.Mock).mockResolvedValue({ available: true });
    (prisma.appointment.update as jest.Mock).mockResolvedValue({ ...existing, staffId: "staff_2" });

    await reassignAppointmentStaff({
      appointmentId: "appt_1",
      newStaffId: "staff_2",
      reason: "Ada is unavailable at your scheduled time",
      actor,
    });

    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "REASSIGNED",
          previousValue: JSON.stringify({ staffId: "staff_1" }),
          newValue: JSON.stringify({ staffId: "staff_2" }),
        }),
      })
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "appointment.reassigned",
      "biz_1",
      expect.objectContaining({ previousStaffId: "staff_1", reason: "Ada is unavailable at your scheduled time" })
    );
  });
});

describe("acknowledgeAttention", () => {
  it("clears needsAttention/attentionReason and records an ATTENTION_RESOLVED event, without changing status", async () => {
    const existing = buildAppointment({ status: "PENDING", needsAttention: true, attentionReason: "stale" });
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);
    (prisma.appointment.update as jest.Mock).mockResolvedValue({ ...existing, needsAttention: false, attentionReason: null });

    const result = await acknowledgeAttention({ appointmentId: "appt_1", actor });

    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt_1" },
      data: { needsAttention: false, attentionReason: null },
    });
    const updateCall = (prisma.appointment.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("status");
    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ATTENTION_RESOLVED" }) })
    );
    expect(result.needsAttention).toBe(false);
  });

  it("is idempotent — does nothing if the appointment isn't currently flagged", async () => {
    const existing = buildAppointment({ needsAttention: false });
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);

    const result = await acknowledgeAttention({ appointmentId: "appt_1", actor });

    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });
});
