import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { getClientStats } from "../modules/clients/clientStats";
import { updateClient } from "../modules/clients/clientService";

export const clientsRouter = Router();

clientsRouter.get("/", requirePermission("clients", "view"), async (req, res) => {
  const clients = await prisma.client.findMany({ where: { businessId: req.actor!.businessId } });
  res.json(clients);
});

clientsRouter.get("/:id", requirePermission("clients", "view"), async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  try {
    assertBelongsToBusiness(req.actor!, client.businessId, "client");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(client);
});

// Section 8: this is the ONLY place visit stats are read from — always
// derived live, never a stored field the client record could carry.
clientsRouter.get("/:id/stats", requirePermission("clients", "view"), async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  try {
    assertBelongsToBusiness(req.actor!, client.businessId, "client");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(await getClientStats(req.params.id));
});

clientsRouter.post("/", requirePermission("clients", "create"), async (req, res) => {
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
    res.status(400).json({ error: err.message });
  }
});

clientsRouter.put("/:id", requirePermission("clients", "edit"), async (req, res) => {
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
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});
