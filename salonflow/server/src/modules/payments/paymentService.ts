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
  if (!input.clientId) throw new Error("Client is required");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error("Payment amount must be a positive whole number in minor units");
  }
  if (!Object.values(PaymentMethod).includes(input.method)) {
    throw new Error("Payment method is invalid");
  }

  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client || client.businessId !== input.businessId) {
    throw new Error("Client not found for this business");
  }

  let appointment: { id: string; clientId: string; businessId: string; priceSnapshot: number } | null = null;
  if (input.appointmentId) {
    appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appointment || appointment.businessId !== input.businessId) {
      throw new Error("Appointment not found for this business");
    }
    if (appointment.clientId !== input.clientId) {
      throw new Error("Payment client must match the appointment client");
    }
  }

  const payment = await prisma.$transaction(async (tx) => {
    if (appointment) {
      const paid = await tx.payment.aggregate({
        where: { appointmentId: appointment.id, status: "PAID" },
        _sum: { amount: true },
      });
      const outstanding = Math.max(appointment.priceSnapshot - (paid._sum.amount ?? 0), 0);
      if (input.amount > outstanding) {
        throw new Error("Payment amount exceeds the appointment outstanding balance");
      }
    }

    const created = await tx.payment.create({
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

    if (appointment) {
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          type: "PAYMENT_ADDED",
          newValue: JSON.stringify({ amount: input.amount, method: input.method }),
          actorType: "USER",
          actorUserId: input.actorUserId,
        },
      });
    }
    return created;
  }, { isolationLevel: "Serializable" });

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
