import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePermission } from "../middleware/authorize";
import { assertBelongsToBusiness, ForbiddenError } from "../core/tenantGuard";
import {
  createKnowledgeBaseEntry,
  updateKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
} from "../modules/ai/knowledgeBaseService";
import { promoteEscalationToKnowledgeBase } from "../modules/ai/aiKnowledge";

export const knowledgeBaseRouter = Router();

knowledgeBaseRouter.get("/", requirePermission("ai_receptionist", "view"), async (req, res) => {
  const entries = await prisma.knowledgeBaseEntry.findMany({
    where: { businessId: req.actor!.businessId },
    orderBy: { createdAt: "desc" },
  });
  res.json(entries);
});

knowledgeBaseRouter.post("/", requirePermission("ai_receptionist", "edit"), async (req, res) => {
  try {
    const entry = await createKnowledgeBaseEntry({
      ...req.body,
      businessId: req.actor!.businessId!,
      actorUserId: req.actor!.userId,
    });
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

knowledgeBaseRouter.put("/:id", requirePermission("ai_receptionist", "edit"), async (req, res) => {
  try {
    const existing = await prisma.knowledgeBaseEntry.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "knowledge base entry");

    const updated = await updateKnowledgeBaseEntry({
      entryId: req.params.id,
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

knowledgeBaseRouter.delete("/:id", requirePermission("ai_receptionist", "edit"), async (req, res) => {
  try {
    const existing = await prisma.knowledgeBaseEntry.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBelongsToBusiness(req.actor!, existing.businessId, "knowledge base entry");

    await deleteKnowledgeBaseEntry(req.params.id, req.actor!.businessId!, req.actor!.userId);
    res.status(204).send();
  } catch (err: any) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Section 24: once a human resolves an AI escalation, the answer can become
// part of the salon's permanent knowledge base — so the same question never
// has to be escalated again.
knowledgeBaseRouter.post("/promote-escalation", requirePermission("ai_receptionist", "edit"), async (req, res) => {
  try {
    const { topic, question, answer } = req.body;
    const entry = await promoteEscalationToKnowledgeBase(req.actor!.businessId!, topic, question, answer);
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
