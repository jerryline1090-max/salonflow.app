jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { eventBus } from "../../../core/eventBus";
import { writeAuditLog } from "../../../core/auditLog";
import { recordPayment, getOutstandingBalance } from "../paymentService";
import { buildAppointment } from "../../../test-utils/factories";

beforeEach(() => {
  jest.spyOn(eventBus, "emit").mockResolvedValue(undefined);
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("getOutstandingBalance", () => {
  it("computes outstanding as the historical price snapshot minus paid amount", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ priceSnapshot: 4_000_000 }));
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 1_500_000 } });

    const result = await getOutstandingBalance("appt_1");

    expect(result).toEqual({ priceSnapshot: 4_000_000, paidAmount: 1_500_000, outstanding: 2_500_000 });
  });

  it("never goes negative even if overpaid", async () => {
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ priceSnapshot: 4_000_000 }));
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 5_000_000 } });

    const result = await getOutstandingBalance("appt_1");

    expect(result.outstanding).toBe(0);
  });

  it("uses the appointment's historical price snapshot, not whatever the service currently costs", async () => {
    // priceSnapshot is 4,000,000 even though the caller might expect the
    // *current* service price is 5,000,000 after a price change.
    (prisma.appointment.findUniqueOrThrow as jest.Mock).mockResolvedValue(buildAppointment({ priceSnapshot: 4_000_000 }));
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });

    const result = await getOutstandingBalance("appt_1");

    expect(result.priceSnapshot).toBe(4_000_000);
  });
});

describe("recordPayment", () => {
  it("creates a payment, links a PAYMENT_ADDED event to the appointment, and emits payment.recorded", async () => {
    const payment = { id: "pay_1", amount: 1_000_000 };
    (prisma.payment.create as jest.Mock).mockResolvedValue(payment);

    await recordPayment({
      businessId: "biz_1",
      clientId: "client_1",
      appointmentId: "appt_1",
      amount: 1_000_000,
      method: "CASH",
      actorUserId: "user_1",
    });

    expect(prisma.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "PAYMENT_ADDED", appointmentId: "appt_1" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ resource: "payment", action: "record" }));
    expect(eventBus.emit).toHaveBeenCalledWith("payment.recorded", "biz_1", { payment });
  });

  it("skips the appointment history event when the payment isn't linked to an appointment", async () => {
    (prisma.payment.create as jest.Mock).mockResolvedValue({ id: "pay_2", amount: 500_000 });

    await recordPayment({
      businessId: "biz_1",
      clientId: "client_1",
      amount: 500_000,
      method: "TRANSFER",
      actorUserId: "user_1",
    });

    expect(prisma.appointmentEvent.create).not.toHaveBeenCalled();
  });
});
