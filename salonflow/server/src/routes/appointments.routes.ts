import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import {
  createAppointment,
  changeAppointmentStatus,
  rescheduleAppointment,
  reassignAppointmentStaff,
  acknowledgeAttention,
} from "../modules/appointments/appointmentService";
import { resolveOwnStaffId } from "../modules/staff/resolveOwnStaffId";
import { asyncHandler } from "../middleware/asyncHandler";
import { rethrowIfDatabaseUnavailable } from "../middleware/errorHandler";
import { pageResult, parsePagination } from "../core/pagination";
import { AppointmentConflictError } from "../modules/appointments/appointmentTransaction";

export const appointmentsRouter = Router();

function rethrowAppointmentInfrastructure(error: unknown) {
  rethrowIfDatabaseUnavailable(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientValidationError) throw error;
}

// Every handler below assumes `authenticate` has already run (mounted in
// index.ts) so `req.actor` is guaranteed to be set.

appointmentsRouter.get("/", requirePermission("appointments", "view"), asyncHandler(async (req, res) => {
  const { from, to, status, needsAttention, staffId, clientId } = req.query as Record<string, string>;

  const where: any = { businessId: req.actor!.businessId };
  if (req.actor!.role === "STAFF") {
    const ownStaffId = await resolveOwnStaffId(req.actor!.userId);
    where.staffId = ownStaffId ?? "__none__"; // a staff user with no linked profile sees nothing, not everything
  } else if (staffId) {
    where.staffId = staffId;
  }
  if (status) where.status = status;
  if (needsAttention === "true") where.needsAttention = true;
  if (clientId) where.clientId = clientId;
  if (from || to) {
    where.startsAt = {};
    if (from) where.startsAt.gte = new Date(from);
    if (to) where.startsAt.lte = new Date(to);
  }

  const { page, limit, skip } = parsePagination(req.query);
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: [{ startsAt: "asc" }, { id: "asc" }], skip, take: limit, include: { client: { select: { id: true, name: true, phone: true, email: true } }, service: { select: { id: true, name: true, price: true, durationMinutes: true } }, staff: { select: { id: true, name: true } } } }),
    prisma.appointment.count({ where }),
  ]);
  res.json(pageResult(items, total, page, limit));
}));

appointmentsRouter.get("/:id", requirePermission("appointments", "view"), asyncHandler(async (req, res) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: req.params.id },
    include: { client: true, service: true, staff: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });
  try {
    assertBelongsToBusiness(req.actor!, appointment.businessId, "appointment");
    if (req.actor!.role === "STAFF") {
      const ownStaffId = await resolveOwnStaffId(req.actor!.userId);
      if (appointment.staffId !== ownStaffId) {
        return res.status(403).json({ error: "You can only view your own appointments" });
      }
    }
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(appointment);
}));

appointmentsRouter.post("/", requirePermission("appointments", "create"), asyncHandler(async (req, res) => {
  try {
    const appointment = await createAppointment({
      // businessId ALWAYS comes from the authenticated actor, never the
      // request body — otherwise a caller could book into another salon.
      businessId: req.actor!.businessId!,
      clientId: req.body.clientId,
      serviceId: req.body.serviceId,
      staffId: req.body.staffId,
      startsAt: new Date(req.body.startsAt),
      locationType: req.body.locationType,
      homeAddress: req.body.homeAddress,
      bookingChannel: req.body.bookingChannel ?? "DASHBOARD",
      notes: req.body.notes,
      actor: { type: "USER", userId: req.actor!.userId },
    });
    res.status(201).json(appointment);
  } catch (err: any) {
    rethrowAppointmentInfrastructure(err);
    if (err instanceof AppointmentConflictError) return res.status(409).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));

appointmentsRouter.post("/:id/status", requirePermission("appointments", "edit"), asyncHandler(async (req, res) => {
  try {
    const existing = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "appointment");
    if (req.actor!.role === "STAFF") {
      const ownStaffId = await resolveOwnStaffId(req.actor!.userId);
      if (existing.staffId !== ownStaffId) {
        return res.status(403).json({ error: "You can only update your own appointments" });
      }
    }

    const updated = await changeAppointmentStatus({
      appointmentId: req.params.id,
      newStatus: req.body.newStatus,
      reason: req.body.reason,
      actor: { type: "USER", userId: req.actor!.userId },
    });
    res.json(updated);
  } catch (err: any) {
    rethrowAppointmentInfrastructure(err);
    if (err instanceof AppointmentConflictError) return res.status(409).json({ error: err.message });
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));

appointmentsRouter.post("/:id/reschedule", requirePermission("appointments", "edit"), asyncHandler(async (req, res) => {
  try {
    const existing = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "appointment");
    if (req.actor!.role === "STAFF") {
      const ownStaffId = await resolveOwnStaffId(req.actor!.userId);
      if (existing.staffId !== ownStaffId) {
        return res.status(403).json({ error: "You can only update your own appointments" });
      }
    }

    const updated = await rescheduleAppointment({
      appointmentId: req.params.id,
      newStartsAt: new Date(req.body.newStartsAt),
      actor: { type: "USER", userId: req.actor!.userId },
    });
    res.json(updated);
  } catch (err: any) {
    rethrowAppointmentInfrastructure(err);
    if (err instanceof AppointmentConflictError) return res.status(409).json({ error: err.message });
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));

appointmentsRouter.post("/:id/acknowledge-attention", requirePermission("appointments", "edit"), asyncHandler(async (req, res) => {
  try {
    const existing = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "appointment");
    if (req.actor!.role === "STAFF") {
      const ownStaffId = await resolveOwnStaffId(req.actor!.userId);
      if (existing.staffId !== ownStaffId) {
        return res.status(403).json({ error: "You can only update your own appointments" });
      }
    }

    const updated = await acknowledgeAttention({ appointmentId: req.params.id, actor: { type: "USER", userId: req.actor!.userId } });
    res.json(updated);
  } catch (err: any) {
    rethrowAppointmentInfrastructure(err);
    if (err instanceof AppointmentConflictError) return res.status(409).json({ error: err.message });
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));

appointmentsRouter.post("/:id/reassign", requirePermission("appointments", "edit"), asyncHandler(async (req, res) => {
  // Reassigning to a different staff member is a step above ordinary
  // appointment editing — it's an owner/manager decision (section 11), not
  // something the "edit" permission on its own should hand to any staff
  // member just because they can update their own appointment's status.
  if (req.actor!.role === "STAFF") {
    return res.status(403).json({ error: "Only an owner or manager can reassign an appointment to different staff" });
  }
  try {
    const existing = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "appointment");

    const updated = await reassignAppointmentStaff({
      appointmentId: req.params.id,
      newStaffId: req.body.newStaffId,
      reason: req.body.reason,
      actor: { type: "USER", userId: req.actor!.userId },
    });
    res.json(updated);
  } catch (err: any) {
    rethrowAppointmentInfrastructure(err);
    if (err instanceof AppointmentConflictError) return res.status(409).json({ error: err.message });
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));
