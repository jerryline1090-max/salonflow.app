import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";
import { writeAuditLog } from "../../core/auditLog";
import { appendOutboundMessage } from "../conversations/conversationEngine";
import { sendToClientChannel } from "../notifications/channelMessenger";

/**
 * Section 30: after a completed appointment, ask "how was your experience?".
 * Happy gets offered a Google review link. Unhappy - or anything ambiguous
 * enough that a human should glance at it - is routed privately to the
 * salon FIRST, never straight to a public review. Nothing in this file
 * ever invents, edits, or discards what a client actually said.
 */

function buildFeedbackPrompt(clientName: string, serviceName: string, staffName: string): string {
  return `Hi ${clientName}! We hope you loved your ${serviceName} with ${staffName}. How was your experience? Reply with a rating from 1-5, or just tell us how it went.`;
}

/**
 * Step 1 (run on a schedule): find COMPLETED appointments old enough (per
 * the business's configured delay) that don't have a feedback request yet,
 * and queue one each. Queuing is separate from sending so a business can
 * pause sending (e.g. during an incident) without losing track of who's owed one.
 */
export async function queuePendingReputationRequests(businessId?: string) {
  const businesses = businessId
    ? [await prisma.business.findUnique({ where: { id: businessId } })].filter((b): b is NonNullable<typeof b> => Boolean(b))
    : await prisma.business.findMany({ where: { reputationEnabled: true } });

  let queued = 0;

  for (const business of businesses) {
    if (!business.reputationEnabled) continue;
    const cutoff = new Date(Date.now() - business.reputationRequestDelayHours * 60 * 60 * 1000);

    const eligible = await prisma.appointment.findMany({
      where: {
        businessId: business.id,
        status: "COMPLETED",
        updatedAt: { lte: cutoff },
        reputationRequest: null,
      },
    });

    for (const appointment of eligible) {
      await prisma.reputationRequest.create({
        data: {
          businessId: business.id,
          appointmentId: appointment.id,
          clientId: appointment.clientId,
          status: "PENDING",
        },
      });
      queued++;
    }
  }

  return { queued };
}

/**
 * Step 2 (run on a schedule, after queuing): actually send each PENDING
 * request through whichever channel the client has an existing
 * conversation on. A client who's never messaged in on any channel (only
 * ever booked via the dashboard) currently has no way to be reached -
 * marked EXPIRED so the owner can see it and follow up manually elsewhere,
 * rather than silently disappearing.
 */
export async function sendPendingReputationRequests(businessId?: string) {
  const pending = await prisma.reputationRequest.findMany({
    where: { businessId, status: "PENDING" },
    include: { appointment: { include: { client: true, service: true, staff: true } } },
  });

  let sent = 0;
  let skipped = 0;

  for (const request of pending) {
    const { appointment } = request;

    const conversation = await prisma.conversation.findFirst({
      where: { clientId: appointment.clientId, businessId: request.businessId, channel: { in: ["WHATSAPP", "INSTAGRAM"] } },
      orderBy: { lastMessageAt: "desc" },
    });

    if (!conversation) {
      await prisma.reputationRequest.update({ where: { id: request.id }, data: { status: "EXPIRED" } });
      skipped++;
      continue;
    }

    const text = buildFeedbackPrompt(appointment.client.name, appointment.service.name, appointment.staff.name);
    const result = await sendToClientChannel(
      request.businessId,
      conversation.channel,
      conversation.externalConversationId,
      conversation.externalUserId,
      text
    );

    if (result.success) {
      await appendOutboundMessage(conversation.id, { text, actorType: "AI", relatedAppointmentId: appointment.id });
      await prisma.reputationRequest.update({
        where: { id: request.id },
        data: { status: "SENT", sentAt: new Date(), conversationId: conversation.id },
      });
      sent++;
    } else {
      skipped++;
    }
  }

  return { sent, skipped };
}

interface ParsedSentiment {
  sentiment: "HAPPY" | "NEUTRAL" | "UNHAPPY";
  rating?: number;
}

/**
 * Deliberately a simple, deterministic heuristic rather than a model call -
 * predictable and fully testable. A production deployment could route
 * genuinely ambiguous free-text through the configured AiModelClient for
 * better sentiment detection, but the numeric-rating path (the common
 * case if the prompt is followed) never needs that at all.
 */
function parseSentiment(text: string, happyThreshold: number): ParsedSentiment {
  const ratingMatch = text.match(/\b([1-5])\b/);
  if (ratingMatch) {
    const rating = parseInt(ratingMatch[1], 10);
    const sentiment = rating >= happyThreshold ? "HAPPY" : rating <= 2 ? "UNHAPPY" : "NEUTRAL";
    return { sentiment, rating };
  }

  const lower = text.toLowerCase();
  const positiveWords = ["great", "amazing", "love", "loved", "excellent", "happy", "good", "fantastic", "wonderful", "perfect"];
  const negativeWords = ["bad", "terrible", "unhappy", "disappointed", "poor", "awful", "hate", "worst", "rude"];

  if (negativeWords.some((w) => lower.includes(w))) return { sentiment: "UNHAPPY" };
  if (positiveWords.some((w) => lower.includes(w))) return { sentiment: "HAPPY" };
  return { sentiment: "NEUTRAL" };
}

/**
 * Called by the AI Receptionist orchestrator on every inbound message
 * BEFORE the normal tool-calling loop: is this conversation waiting on a
 * feedback response? If so, this message IS that response - handle it here
 * rather than treating it as a fresh booking/question. Returns
 * `{ handled: false }` for the overwhelming majority of ordinary messages
 * (a single indexed lookup), so this never gets in the way of normal use.
 */
export async function recordReputationResponse(
  conversationId: string,
  businessId: string,
  messageText: string
): Promise<{ handled: boolean; reply?: string }> {
  const pendingRequest = await prisma.reputationRequest.findFirst({
    where: { conversationId, status: "SENT" },
  });
  if (!pendingRequest) {
    return { handled: false };
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const { sentiment, rating } = parseSentiment(messageText, business.reputationHappyThreshold);

  await prisma.reputationRequest.update({
    where: { id: pendingRequest.id },
    data: { status: "RESPONDED", respondedAt: new Date(), sentiment, rating, feedbackText: messageText },
  });

  await writeAuditLog({
    businessId,
    actorType: "SYSTEM",
    resource: "reputation_request",
    resourceId: pendingRequest.id,
    action: "respond",
    newValue: { sentiment, rating, feedbackText: messageText },
  });

  await eventBus.emit("reputation.response_received", businessId, {
    reputationRequestId: pendingRequest.id,
    appointmentId: pendingRequest.appointmentId,
    clientId: pendingRequest.clientId,
    sentiment,
    rating,
    feedbackText: messageText,
  });

  if (sentiment === "HAPPY") {
    const reply = business.googleReviewUrl
      ? `So glad to hear that! If you have a moment, we'd really appreciate a review here: ${business.googleReviewUrl}`
      : "So glad to hear that! Thank you so much for letting us know.";
    return { handled: true, reply };
  }

  if (sentiment === "UNHAPPY") {
    // Section 30's central rule: route privately to the salon, never push
    // toward a public review. The notification listener (registered
    // alongside every other notification in notificationListeners.ts)
    // reacts to the event emitted above - nothing separate happens here.
    return {
      handled: true,
      reply: "Thank you for being honest with us — we're sorry to hear that. Someone from the salon will reach out to make it right.",
    };
  }

  // NEUTRAL/ambiguous: still worth a human glance (already notified via the
  // event above), but no public review push since we're not confident they
  // were happy.
  return { handled: true, reply: "Thank you so much for the feedback!" };
}

/** Owner-facing: mark a routed piece of feedback as resolved once they've followed up. */
export async function resolveReputationRequest(id: string, businessId: string, actorUserId: string, resolutionNotes?: string) {
  const existing = await prisma.reputationRequest.findUniqueOrThrow({ where: { id } });
  if (existing.businessId !== businessId) {
    throw new Error("Feedback request not found for this business");
  }

  const updated = await prisma.reputationRequest.update({
    where: { id },
    data: { resolvedAt: new Date(), resolutionNotes },
  });

  await writeAuditLog({
    businessId,
    actorUserId,
    resource: "reputation_request",
    resourceId: id,
    action: "resolve",
    newValue: { resolutionNotes },
  });

  return updated;
}
