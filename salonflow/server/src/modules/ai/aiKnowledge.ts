import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";

/**
 * Section 23–25 (hard rule): if the AI Receptionist doesn't have a
 * confident, sourced answer, it escalates — it never invents salon-specific
 * facts (pricing, product brands, policies, etc.).
 *
 * This function is intentionally "dumb": it only ever answers from data
 * that actually lives in SalonFlow (Service records or the salon's own
 * KnowledgeBaseEntry rows). If nothing matches, it escalates. The actual
 * language model layer that talks to the client sits in front of this and
 * MUST treat "no match" as "say you don't know and escalate", never as
 * license to generate a plausible-sounding answer of its own.
 */
export async function resolveClientQuestion(businessId: string, question: string) {
  const normalized = question.toLowerCase();

  // 1. Can this be answered directly from structured Service data?
  const services = await prisma.service.findMany({ where: { businessId, isActive: true } });
  const matchedService = services.find((s) => normalized.includes(s.name.toLowerCase()));
  if (matchedService && /price|cost|how much|duration|long|available/.test(normalized)) {
    return {
      answered: true,
      source: "SERVICE_DATA",
      answer: {
        service: matchedService.name,
        price: matchedService.price,
        durationMinutes: matchedService.durationMinutes,
        availableAtSalon: matchedService.availableAtSalon,
        availableAtHome: matchedService.availableAtHome,
      },
    };
  }

  // 2. Can this be answered from the salon's own knowledge base entries?
  const kbEntries = await prisma.knowledgeBaseEntry.findMany({ where: { businessId } });
  const matchedEntry = kbEntries.find(
    (e) => normalized.includes(e.topic.toLowerCase()) || (e.question && normalized.includes(e.question.toLowerCase()))
  );
  if (matchedEntry) {
    return { answered: true, source: "KNOWLEDGE_BASE", answer: matchedEntry.answer };
  }

  // 3. No confident source — escalate to a human rather than guess.
  await eventBus.emit("ai.escalation_needed", businessId, { question });

  return {
    answered: false,
    source: null,
    answer:
      "I don't have that information yet and I don't want to give you the wrong answer. I'll ask someone from the salon to confirm.",
  };
}

/** Section 24: once a human answers an escalated question, it can join the knowledge base. */
export async function promoteEscalationToKnowledgeBase(businessId: string, topic: string, question: string, answer: string) {
  return prisma.knowledgeBaseEntry.create({
    data: { businessId, topic, question, answer, source: "ESCALATION_RESOLVED" },
  });
}
