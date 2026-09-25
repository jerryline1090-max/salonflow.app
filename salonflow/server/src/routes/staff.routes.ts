import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { setStaffStatus } from "../modules/staff/staffLifecycle";
import { createStaffProfile, updateStaffProfile, setStaffSchedule, setStaffServices } from "../modules/staff/staffProfile";

export const staffRouter = Router();

staffRouter.get("/", requirePermission("staff", "view"), async (req, res) => {
  const staff = await prisma.staff.findMany({
    where: { businessId: req.actor!.businessId },
    include: { services: { include: { service: true } }, schedule: true },
  });
  res.json(staff);
});

staffRouter.get("/:id", requirePermission("staff", "view"), async (req, res) => {
  const staff = await prisma.staff.findUnique({
    where: { id: req.params.id },
    include: { services: { include: { service: true } }, schedule: true, timeOff: true },
  });
  if (!staff) return res.status(404).json({ error: "Staff member not found" });
  try {
    assertBelongsToBusiness(req.actor!, staff.businessId, "staff member");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(staff);
});

// Creating the operational Staff profile (distinct from a login-capable
// User account — see routes/auth.routes.ts's /team endpoint for that).
// OWNER-only by default (same reasoning as team creation: bringing a new
// staff member into the system is an owner-level decision).
staffRouter.post("/", requirePermission("staff", "create"), async (req, res) => {
  try {
    const staff = await createStaffProfile({ ...req.body, businessId: req.actor!.businessId!, actorUserId: req.actor!.userId });
    res.status(201).json(staff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

staffRouter.put("/:id", requirePermission("staff", "edit"), async (req, res) => {
  try {
    const existing = await prisma.staff.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "staff member");

    const updated = await updateStaffProfile({
      staffId: req.params.id,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      updates: req.body,
    });
    res.json(updated);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Replaces the staff member's weekly schedule — the same schedule
// staffAvailability.ts checks for every booking on every channel.
staffRouter.put("/:id/schedule", requirePermission("staff", "edit"), async (req, res) => {
  try {
    const existing = await prisma.staff.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "staff member");

    const schedule = await setStaffSchedule({
      staffId: req.params.id,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      schedule: req.body.schedule,
    });
    res.json(schedule);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Replaces which services this staff member is qualified to perform — the
// same link the AI Receptionist's findQualifiedStaffForService tool reads.
staffRouter.put("/:id/services", requirePermission("staff", "edit"), async (req, res) => {
  try {
    const existing = await prisma.staff.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "staff member");

    const links = await setStaffServices({
      staffId: req.params.id,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      serviceIds: req.body.serviceIds,
    });
    res.json(links);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Section 10–11: changing/removing a staff member surfaces affected
// appointments in the response — the caller (dashboard UI) is expected to
// immediately prompt for reassignment rather than treat this as "done".
staffRouter.post("/:id/status", requirePermission("staff", "edit"), async (req, res) => {
  try {
    const existing = await prisma.staff.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "staff member");

    const result = await setStaffStatus({
      staffId: req.params.id,
      newStatus: req.body.newStatus,
      actorUserId: req.actor!.userId,
    });
    res.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});
