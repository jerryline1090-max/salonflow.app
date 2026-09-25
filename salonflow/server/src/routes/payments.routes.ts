import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { recordPayment, getOutstandingBalance } from "../modules/payments/paymentService";

export const paymentsRouter = Router();

paymentsRouter.get("/", requirePermission("payments", "view"), async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { businessId: req.actor!.businessId },
    orderBy: { createdAt: "desc" },
    include: { client: true, appointment: { include: { service: true } } },
  });
  res.json(payments);
});

paymentsRouter.post("/", requirePermission("payments", "create"), async (req, res) => {
  try {
    if (req.body.appointmentId) {
      const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: req.body.appointmentId } });
      assertBelongsToBusiness(req.actor!, appointment.businessId, "appointment");
    }
    const payment = await recordPayment({
      businessId: req.actor!.businessId!,
      clientId: req.body.clientId,
      appointmentId: req.body.appointmentId,
      amount: req.body.amount,
      method: req.body.method,
      actorUserId: req.actor!.userId,
    });
    res.status(201).json(payment);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

paymentsRouter.get("/appointments/:appointmentId/outstanding", requirePermission("payments", "view"), async (req, res) => {
  try {
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.appointmentId } });
    assertBelongsToBusiness(req.actor!, appointment.businessId, "appointment");
    res.json(await getOutstandingBalance(req.params.appointmentId));
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});
