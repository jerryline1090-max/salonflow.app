import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { getClientStats } from "../modules/clients/clientStats";
import { updateClient } from "../modules/clients/clientService";
import { asyncHandler } from "../middleware/asyncHandler";
import { rethrowIfDatabaseUnavailable } from "../middleware/errorHandler";
import { pageResult, parsePagination } from "../core/pagination";

export const clientsRouter = Router();

clientsRouter.get("/", requirePermission("clients", "view"), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where = { businessId: req.actor!.businessId };
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const searchWhere = search
    ? { ...where, OR: ["name", "phone", "email"].map((field) => ({ [field]: { contains: search, mode: "insensitive" as const } })) }
    : where;
  const [items, total] = await Promise.all([
    prisma.client.findMany({ where: searchWhere, orderBy: search ? [{ name: "asc" }, { id: "asc" }] : { createdAt: "desc" }, skip, take: limit, select: { id: true, name: true, phone: true, email: true, address: true, notes: true } }),
    prisma.client.count({ where: searchWhere }),
  ]);
  res.json(pageResult(items, total, page, limit));
}));

clientsRouter.get("/count", requirePermission("clients", "view"), asyncHandler(async (req, res) => {
  res.json({ count: await prisma.client.count({ where: { businessId: req.actor!.businessId } }) });
}));

clientsRouter.get("/:id", requirePermission("clients", "view"), asyncHandler(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  try {
    assertBelongsToBusiness(req.actor!, client.businessId, "client");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(client);
}));

// Section 8: this is the ONLY place visit stats are read from — always
// derived live, never a stored field the client record could carry.
clientsRouter.get("/:id/stats", requirePermission("clients", "view"), asyncHandler(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  try {
    assertBelongsToBusiness(req.actor!, client.businessId, "client");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(await getClientStats(req.params.id));
}));

clientsRouter.post("/", requirePermission("clients", "create"), asyncHandler(async (req, res) => {
  try {
    const client = await prisma.client.create({
      data: {
        businessId: req.actor!.businessId!,
        name: req.body.name,
        phone: req.body.phone,
        email: req.body.email,
        address: req.body.address,
        notes: req.body.notes,
      },
    });
    res.status(201).json(client);
  } catch (err: any) {
    rethrowIfDatabaseUnavailable(err);
    res.status(400).json({ error: err.message });
  }
}));

clientsRouter.put("/:id", requirePermission("clients", "edit"), asyncHandler(async (req, res) => {
  try {
    const existing = await prisma.client.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "client");

    const updated = await updateClient({
      clientId: req.params.id,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
      updates: req.body,
    });
    res.json(updated);
  } catch (err: any) {
    rethrowIfDatabaseUnavailable(err);
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
}));
