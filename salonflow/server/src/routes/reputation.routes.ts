import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import { resolveReputationRequest } from "../modules/reputation/reputationService";

export const reputationRouter = Router();

/**
 * Section 30: the owner/manager view onto every feedback request — this is
 * where "route unhappy feedback to the salon before any public review"
 * actually becomes something a human can act on and mark resolved.
 */

reputationRouter.get("/", requirePermission("reputation", "view"), async (req, res) => {
  const { sentiment, status } = req.query as Record<string, string>;
  const requests = await prisma.reputationRequest.findMany({
    where: {
      businessId: req.actor!.businessId,
      sentiment: sentiment ? (sentiment as any) : undefined,
      status: status ? (status as any) : undefined,
    },
    include: { client: true, appointment: { include: { service: true, staff: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(requests);
});

reputationRouter.get("/:id", requirePermission("reputation", "view"), async (req, res) => {
  const request = await prisma.reputationRequest.findUnique({
    where: { id: req.params.id },
    include: { client: true, appointment: { include: { service: true, staff: true } } },
  });
  if (!request) return res.status(404).json({ error: "Feedback request not found" });
  try {
    assertBelongsToBusiness(req.actor!, request.businessId, "feedback request");
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    throw err;
  }
  res.json(request);
});

reputationRouter.post("/:id/resolve", requirePermission("reputation", "edit"), async (req, res) => {
  try {
    const existing = await prisma.reputationRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "feedback request");

    const updated = await resolveReputationRequest(req.params.id, req.actor!.businessId!, req.actor!.userId, req.body.notes);
    res.json(updated);
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});
