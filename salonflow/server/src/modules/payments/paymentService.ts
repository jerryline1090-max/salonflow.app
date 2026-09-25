import { PaymentMethod } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";
import { writeAuditLog } from "../../core/auditLog";

/**
 * Section 13: payments are their own record, linked to (not derived from)
 * an appointment. `amount` is whatever was actually charged at the time —
 * it is never recalculated from the current Service.price, so a later
 * price change can't rewrite history.
 */
export interface RecordPaymentInput {
  businessId: string;
  clientId: string;
  appointmentId?: string;
  amount: number; // minor unit
  method: PaymentMethod;
  actorUserId: string;
}

export async function recordPayment(input: RecordPaymentInput) {
  const payment = await prisma.payment.create({
    data: {
      businessId: input.businessId,
      clientId: input.clientId,
      appointmentId: input.appointmentId,
      amount: input.amount,
      method: input.method,
      status: "PAID",
      paidAt: new Date(),
    },
  });

  if (input.appointmentId) {
    await prisma.appointmentEvent.create({
      data: {
        appointmentId: input.appointmentId,
        type: "PAYMENT_ADDED",
        newValue: JSON.stringify({ amount: input.amount, method: input.method }),
        actorType: "USER",
        actorUserId: input.actorUserId,
      },
    });
  }

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "payment",
    resourceId: payment.id,
    action: "record",
    newValue: payment,
  });

  await eventBus.emit("payment.recorded", input.businessId, { payment });

  return payment;
}

/** Outstanding balance for an appointment: priceSnapshot minus what's actually been paid. */
export async function getOutstandingBalance(appointmentId: string) {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const paid = await prisma.payment.aggregate({
    where: { appointmentId, status: "PAID" },
    _sum: { amount: true },
  });
  const paidAmount = paid._sum.amount ?? 0;
  return {
    priceSnapshot: appointment.priceSnapshot,
    paidAmount,
    outstanding: Math.max(appointment.priceSnapshot - paidAmount, 0),
  };
}
