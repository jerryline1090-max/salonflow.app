import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { createService, updateService } from "../modules/services/serviceService";

export const servicesRouter = Router();

servicesRouter.get("/", requirePermission("services", "view"), async (req, res) => {
  const services = await prisma.service.findMany({
    where: { businessId: req.actor!.businessId },
    orderBy: { name: "asc" },
  });
  res.json(services);
});

servicesRouter.get("/:id", requirePermission("services", "view"), async (req, res) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service) return res.status(404).json({ error: "Service not found" });
  try {
    assertBelongsToBusiness(req.actor!, service.businessId, "service");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(service);
});

servicesRouter.post("/", requirePermission("services", "create"), async (req, res) => {
  try {
    const service = await createService({ ...req.body, businessId: req.actor!.businessId!, actorUserId: req.actor!.userId });
    res.status(201).json(service);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

servicesRouter.put("/:id", requirePermission("services", "edit"), async (req, res) => {
  try {
    const updated = await updateService({
      serviceId: req.params.id,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      updates: req.body,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Soft-delete only (isActive: false) — a service with historical
// appointments must remain readable; its price/duration are already
// captured as snapshots on those appointments (section 13), untouched by this.
servicesRouter.delete("/:id", requirePermission("services", "delete"), async (req, res) => {
  try {
    const updated = await updateService({
      serviceId: req.params.id,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      updates: { isActive: false },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
