jest.mock("../../../lib/prisma");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { scanForAppointmentsNeedingAttention } from "../attentionScanner";
import { buildAppointment, buildClient } from "../../../test-utils/factories";

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
});

describe("scanForAppointmentsNeedingAttention", () => {
  it("does nothing when there are no stale pending/confirmed appointments", async () => {
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

    const result = await scanForAppointmentsNeedingAttention("biz_1");

    expect(result).toEqual({ flaggedCount: 0 });
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("flags a stale pending appointment without ever changing its status", async () => {
    const stale = buildAppointment({ id: "appt_stale", status: "PENDING", client: buildClient({ name: "Sarah" }) });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([stale]);

    const result = await scanForAppointmentsNeedingAttention("biz_1");

    expect(result).toEqual({ flaggedCount: 1 });

    // Only needsAttention/attentionReason are written — status is untouched.
    const updateCall = (prisma.appointment.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("status");
    expect(updateCall.data.needsAttention).toBe(true);
    expect(typeof updateCall.data.attentionReason).toBe("string");

    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "FLAGGED_NEEDS_ATTENTION", actorType: "SYSTEM" }) })
    );

    // The owner is notified with all five safe resolutions — the scanner
    // itself never picks one on the owner's behalf.
    expect(eventBus.emit).toHaveBeenCalledWith(
      "appointment.needs_attention",
      "biz_1",
      expect.objectContaining({
        appointmentId: "appt_stale",
        clientName: "Sarah",
        suggestedActions: ["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULE", "KEEP_PENDING"],
      })
    );
  });

  it("flags every stale appointment found, independently", async () => {
    const staleA = buildAppointment({ id: "appt_a", client: buildClient({ name: "A" }) });
    const staleB = buildAppointment({ id: "appt_b", client: buildClient({ name: "B" }) });
    (prisma.appointment.findMany as jest.Mock).mockResolvedValue([staleA, staleB]);

    const result = await scanForAppointmentsNeedingAttention("biz_1");

    expect(result).toEqual({ flaggedCount: 2 });
    expect(prisma.appointment.update).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
  });
});
