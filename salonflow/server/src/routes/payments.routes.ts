import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { recordPayment, getOutstandingBalance } from "../modules/payments/paymentService";
import { asyncHandler } from "../middleware/asyncHandler";
import { rethrowIfDatabaseUnavailable } from "../middleware/errorHandler";
import { pageResult, parsePagination } from "../core/pagination";

export const paymentsRouter = Router();

paymentsRouter.get("/", requirePermission("payments", "view"), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where = { businessId: req.actor!.businessId };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip, take: limit, include: { client: { select: { id: true, name: true } }, appointment: { select: { service: { select: { id: true, name: true } } } } } }),
    prisma.payment.count({ where }),
  ]);
  res.json(pageResult(items, total, page, limit));
}));

paymentsRouter.post("/", requirePermission("payments", "create"), asyncHandler(async (req, res) => {
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
    rethrowIfDatabaseUnavailable(err);
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));

paymentsRouter.get("/appointments/:appointmentId/outstanding", requirePermission("payments", "view"), asyncHandler(async (req, res) => {
  try {
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.appointmentId } });
    assertBelongsToBusiness(req.actor!, appointment.businessId, "appointment");
    res.json(await getOutstandingBalance(req.params.appointmentId));
  } catch (err: any) {
    rethrowIfDatabaseUnavailable(err);
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));
