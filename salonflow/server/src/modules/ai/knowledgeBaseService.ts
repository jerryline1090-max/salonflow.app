import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../core/auditLog";

/**
 * Section 25: salon-specific knowledge (products, policies, promotions,
 * FAQs) the AI Receptionist answers from — see aiKnowledge.ts, which reads
 * these same rows and nothing else for anything beyond structured Service
 * data. Managing entries here is what keeps that resolver from ever having
 * to guess.
 */

export interface CreateKnowledgeBaseEntryInput {
  businessId: string;
  topic: string;
  question?: string;
  answer: string;
  actorUserId: string;
}

export async function createKnowledgeBaseEntry(input: CreateKnowledgeBaseEntryInput) {
  const entry = await prisma.knowledgeBaseEntry.create({
    data: { businessId: input.businessId, topic: input.topic, question: input.question, answer: input.answer, source: "OWNER" },
  });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "settings",
    resourceId: entry.id,
    action: "create_knowledge_entry",
    newValue: entry,
  });

  return entry;
}

export interface UpdateKnowledgeBaseEntryInput {
  entryId: string;
  businessId: string;
  actorUserId: string;
  updates: Partial<{ topic: string; question: string; answer: string }>;
}

export async function updateKnowledgeBaseEntry(input: UpdateKnowledgeBaseEntryInput) {
  const existing = await prisma.knowledgeBaseEntry.findUniqueOrThrow({ where: { id: input.entryId } });
  if (existing.businessId !== input.businessId) {
    throw new Error("Knowledge base entry not found for this business");
  }

  const updated = await prisma.knowledgeBaseEntry.update({ where: { id: input.entryId }, data: input.updates });

  await writeAuditLog({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    resource: "settings",
    resourceId: existing.id,
    action: "update_knowledge_entry",
    previousValue: existing,
    newValue: updated,
  });

  return updated;
}

export async function deleteKnowledgeBaseEntry(entryId: string, businessId: string, actorUserId: string) {
  const existing = await prisma.knowledgeBaseEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (existing.businessId !== businessId) {
    throw new Error("Knowledge base entry not found for this business");
  }

  await prisma.knowledgeBaseEntry.delete({ where: { id: entryId } });

  await writeAuditLog({
    businessId,
    actorUserId,
    resource: "settings",
    resourceId: existing.id,
    action: "delete_knowledge_entry",
    previousValue: existing,
  });
}
