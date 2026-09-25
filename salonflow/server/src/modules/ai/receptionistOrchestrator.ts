import { prisma } from "../../lib/prisma";
import {
  ingestInboundMessage,
  getRecentContext,
  updateMessageProcessing,
  appendOutboundMessage,
  markEscalated,
} from "../conversations/conversationEngine";
import { UnifiedInboundMessage, ChannelAdapter } from "./channels/types";
import { MediaStore } from "./mediaStore";
import { SpeechToTextService } from "./speechToText";
import { MediaUnderstandingService, MEDIA_CONFIDENCE_THRESHOLD } from "./mediaUnderstanding";
import { AiModelClient, OrchestratorMessage, ToolCallResult } from "./aiModelClient";
import { eventBus } from "../../core/eventBus";
import * as tools from "./receptionistTools";
import { ReceptionistContext } from "./receptionistTools";
import { recordReputationResponse } from "../reputation/reputationService";

/**
 * Section 21's architecture diagram, as code:
 *   Channel Adapter → Unified Conversation Engine → AI Receptionist →
 *   Salon Knowledge + Client Context → Controlled SalonFlow Tools →
 *   SalonFlow Core → Database / Events / Notifications
 *
 * This file IS the "AI Receptionist" box. It never touches Prisma for
 * anything business-meaningful itself — only through the fixed tool
 * allowlist in receptionistTools.ts.
 */

const MAX_TOOL_ITERATIONS = 4;

// Every tool the model is allowed to invoke, and how to dispatch a call to
// it. Adding a capability means adding one line here — the model can never
// call anything not listed.
type ToolFn = (ctx: ReceptionistContext, args: any) => Promise<unknown>;
const TOOL_REGISTRY: Record<string, ToolFn> = {
  searchServices: (ctx, args) => tools.searchServices(ctx, args?.query),
  getService: (ctx, args) => tools.getService(ctx, args.serviceId),
  getBusinessHours: (ctx) => tools.getBusinessHours(ctx),
  findQualifiedStaffForService: (ctx, args) => tools.findQualifiedStaffForService(ctx, args.serviceId),
  checkSlotAvailability: (ctx, args) =>
    tools.checkSlotAvailability(ctx, { ...args, startsAt: new Date(args.startsAt) }),
  suggestNextAvailableSlots: (ctx, args) =>
    tools.suggestNextAvailableSlots(ctx, { ...args, fromDate: args.fromDate ? new Date(args.fromDate) : undefined }),
  bookAppointment: (ctx, args) => tools.bookAppointment(ctx, { ...args, startsAt: new Date(args.startsAt) }),
  getOwnAppointment: (ctx, args) => tools.getOwnAppointment(ctx, args.appointmentId),
  listOwnUpcomingAppointments: (ctx) => tools.listOwnUpcomingAppointments(ctx),
  rescheduleOwnAppointment: (ctx, args) =>
    tools.rescheduleOwnAppointment(ctx, { ...args, newStartsAt: new Date(args.newStartsAt) }),
  cancelOwnAppointment: (ctx, args) => tools.cancelOwnAppointment(ctx, args),
  answerFromKnowledge: (ctx, args) => tools.answerFromKnowledge(ctx, args.question),
};

export interface OrchestratorDeps {
  modelClient: AiModelClient;
  channelAdapter: ChannelAdapter;
  mediaStore: MediaStore;
  speechToText: SpeechToTextService;
  mediaUnderstanding: MediaUnderstandingService;
}

const FALLBACK_UNRESOLVED_TEXT =
  "I don't have enough information to help with that confidently, so I've let the team know and someone will follow up shortly.";

export async function handleUnifiedMessage(msg: UnifiedInboundMessage, deps: OrchestratorDeps) {
  const { conversation, message, duplicate } = await ingestInboundMessage(msg);
  if (duplicate) return { handled: false, reason: "duplicate inbound message" };

  // Section 19 / human takeover: once a staff member has taken over, the AI
  // stops autonomously acting on this conversation. The message is still
  // stored so the human sees it — it just isn't handed to the model loop.
  if (conversation.status === "HUMAN_HANDLING" || conversation.status === "CLOSED") {
    return { handled: false, reason: "conversation is not AI-handled" };
  }

  let effectiveText = message.text ?? undefined;

  if (message.type === "VOICE" && message.mediaSecureRef) {
    try {
      const url = await deps.mediaStore.getTemporaryAccessUrl(message.mediaSecureRef);
      const transcription = await deps.speechToText.transcribe({
        secureRef: message.mediaSecureRef,
        mimeType: message.mediaType ?? "audio/ogg",
        temporaryAccessUrl: url,
      });
      await updateMessageProcessing(message.id, { transcription: transcription.text, mediaProcessingStatus: "PROCESSED" });
      effectiveText = transcription.text;
    } catch {
      await updateMessageProcessing(message.id, { mediaProcessingStatus: "FAILED" });
      // Section 20-style graceful degradation for a failed media pipeline:
      // tell the client plainly rather than silently dropping their message
      // or having the model guess at unheard audio.
      const fallback = "Sorry, I couldn't quite process that voice note — could you type it out for me?";
      await appendOutboundMessage(conversation.id, { text: fallback, actorType: "AI" });
      await deps.channelAdapter.sendOutbound({
        externalConversationId: conversation.externalConversationId,
        externalUserId: conversation.externalUserId,
        text: fallback,
      });
      return { handled: true, reply: fallback };
    }
  }

  if ((message.type === "IMAGE" || message.type === "VIDEO") && message.mediaSecureRef) {
    try {
      const url = await deps.mediaStore.getTemporaryAccessUrl(message.mediaSecureRef);
      const describe = message.type === "IMAGE" ? deps.mediaUnderstanding.describeImage : deps.mediaUnderstanding.describeVideo;
      const described = await describe({
        temporaryAccessUrl: url,
        mimeType: message.mediaType ?? "image/jpeg",
        businessId: msg.businessId,
        context: effectiveText,
      });
      await updateMessageProcessing(message.id, { mediaProcessingStatus: "PROCESSED" });
      // Section 4 (hard rule): below the confidence threshold, this is
      // surfaced to the model as "unidentified", never as a confident match.
      effectiveText =
        described.confidence >= MEDIA_CONFIDENCE_THRESHOLD
          ? `[Client sent an image/video. System identified it as: ${described.description} (confidence: ${described.confidence.toFixed(2)})]${effectiveText ? " " + effectiveText : ""}`
          : `[Client sent an image/video that could not be confidently identified (confidence: ${described.confidence.toFixed(2)}). Do not guess what it shows — ask the client to describe it or offer to have staff take a look.]${effectiveText ? " " + effectiveText : ""}`;
    } catch {
      await updateMessageProcessing(message.id, { mediaProcessingStatus: "FAILED" });
      effectiveText = `[Client sent an image/video that could not be analyzed. Do not guess what it shows.]${effectiveText ? " " + effectiveText : ""}`;
    }
  }

  if (effectiveText && effectiveText !== message.text) {
    // Persist the enriched text (transcription/description) back onto the
    // message for the transcript, distinct from the raw caption.
    await prisma.conversationMessage.update({ where: { id: message.id }, data: { text: effectiveText } });
  }

  if (!conversation.clientId) {
    // Should not happen — ingestInboundMessage always resolves one — but
    // fail safe rather than proceed without a scoped client.
    await markEscalated(conversation.id, "Could not resolve a client identity for this conversation");
    return { handled: false, reason: "no client resolved" };
  }

  // Section 30: if this conversation is waiting on a reputation/feedback
  // response, THIS message is that response — handle it here, before the
  // normal booking/Q&A tool loop even runs. Returns handled:false for the
  // overwhelming majority of ordinary messages (one indexed lookup).
  const reputationResult = await recordReputationResponse(conversation.id, msg.businessId, effectiveText ?? "");
  if (reputationResult.handled) {
    await appendOutboundMessage(conversation.id, { text: reputationResult.reply!, actorType: "AI" });
    const sendResult = await deps.channelAdapter.sendOutbound({
      externalConversationId: conversation.externalConversationId,
      externalUserId: conversation.externalUserId,
      text: reputationResult.reply!,
    });
    if (!sendResult.success) {
      await eventBus.emit("conversation.send_failed", msg.businessId, {
        conversationId: conversation.id,
        channel: msg.channel,
        error: sendResult.error,
      });
    }
    return { handled: true, reply: reputationResult.reply, escalated: false, sendResult };
  }

  const ctx: ReceptionistContext = { businessId: msg.businessId, clientId: conversation.clientId, conversationId: conversation.id };

  const recent = await getRecentContext(conversation.id, 20);
  const history: OrchestratorMessage[] = recent.map((m) => ({
    role: m.actorType === "CLIENT" ? "client" : m.actorType === "STAFF" ? "staff" : m.actorType === "AI" ? "ai" : "system",
    content: m.text ?? "[unprocessed media]",
  }));

  const toolResultsThisTurn: ToolCallResult[] = [];
  let finalText: string | null = null;
  let escalationReason: string | null = null;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const decision = await deps.modelClient.decide({ businessId: msg.businessId, history, toolResultsThisTurn });

    if (decision.kind === "reply") {
      finalText = decision.text;
      break;
    }

    if (decision.kind === "escalate") {
      escalationReason = decision.reason;
      break;
    }

    // tool_call
    const fn = TOOL_REGISTRY[decision.tool];
    if (!fn) {
      toolResultsThisTurn.push({ tool: decision.tool, args: decision.args, error: `Unknown tool "${decision.tool}"` });
      continue;
    }
    try {
      const result = await fn(ctx, decision.args);
      toolResultsThisTurn.push({ tool: decision.tool, args: decision.args, result });
    } catch (err: any) {
      toolResultsThisTurn.push({ tool: decision.tool, args: decision.args, error: err.message });
    }
  }

  if (!finalText && !escalationReason) {
    // Safety net: never leave a client hanging on an unbounded loop, and
    // never let the model "reply" with something ungrounded just because
    // it ran out of turns — escalate instead (section 8's spirit applied
    // to the orchestration loop, not just single facts).
    escalationReason = "Could not resolve the request within the allowed number of tool calls";
  }

  if (escalationReason) {
    await tools.escalateToStaff(ctx, { question: history[history.length - 1]?.content ?? "", reason: escalationReason });
    finalText = FALLBACK_UNRESOLVED_TEXT;
  }

  await appendOutboundMessage(conversation.id, { text: finalText!, actorType: "AI" });

  const sendResult = await deps.channelAdapter.sendOutbound({
    externalConversationId: conversation.externalConversationId,
    externalUserId: conversation.externalUserId,
    text: finalText!,
  });

  if (!sendResult.success) {
    // Section 20: record the failure and notify the salon — never claim
    // success to internal callers/logs when the channel actually failed.
    await eventBus.emit("conversation.send_failed", msg.businessId, {
      conversationId: conversation.id,
      channel: msg.channel,
      error: sendResult.error,
    });
  }

  return { handled: true, reply: finalText, escalated: Boolean(escalationReason), sendResult };
}
