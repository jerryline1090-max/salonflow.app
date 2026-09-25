import { AppointmentStatus, LocationType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ActorContext } from "../../core/permissions";
import { AiModelClient, OrchestratorMessage, ToolCallResult } from "./aiModelClient";
import * as tools from "./assistantTools";

/**
 * Structurally the same shape as receptionistOrchestrator.ts's loop
 * (decide, dispatch tool, feed result back, repeat, capped, safety-net
 * fallback) - deliberately so, since the safety properties are the same
 * class of problem. The differences are what make this the *Assistant* and
 * not another Receptionist: the actor is a real authenticated User with a
 * real Role (not a fixed CLIENT-shaped context), every tool call is
 * permission-checked per-call via `assertCan` rather than pre-scoped by a
 * narrow allowlist, and there's no "escalate to a human" - the person
 * asking already IS the human; if the model can't help, it just says so.
 */

const MAX_TOOL_ITERATIONS = 4;

type ToolFn = (actor: ActorContext, args: any) => Promise<unknown>;

const TOOL_REGISTRY: Record<string, ToolFn> = {
  searchAppointments: (actor, args) =>
    tools.searchAppointments(actor, {
      ...args,
      dateFrom: args.dateFrom ? new Date(args.dateFrom) : undefined,
      dateTo: args.dateTo ? new Date(args.dateTo) : undefined,
    }),
  getAppointment: (actor, args) => tools.getAppointment(actor, args.appointmentId),
  moveAppointment: (actor, args) => tools.moveAppointment(actor, args.appointmentId, new Date(args.newStartsAt)),
  changeAppointmentStatus: (actor, args) =>
    tools.changeAppointmentStatusTool(actor, args.appointmentId, args.newStatus as AppointmentStatus, args.reason),
  reassignAppointment: (actor, args) => tools.reassignAppointmentTool(actor, args.appointmentId, args.newStaffId, args.reason),
  getRevenueReport: (actor, args) => tools.getRevenueReport(actor, new Date(args.from), new Date(args.to)),
  getAppointmentOutcomeReport: (actor, args) => tools.getAppointmentOutcomeReport(actor, new Date(args.from), new Date(args.to)),
  getPopularServicesReport: (actor, args) => tools.getPopularServicesReport(actor, new Date(args.from), new Date(args.to)),
  getStaffPerformanceReport: (actor, args) => tools.getStaffPerformanceReport(actor, new Date(args.from), new Date(args.to)),
  getClientRetentionReport: (actor) => tools.getClientRetentionReport(actor),
  getClientCount: (actor) => tools.getClientCount(actor),
  getClientStats: (actor, args) => tools.getClientStats(actor, args.clientId),
  listStaffAvailableOnDate: (actor, args) => tools.listStaffAvailableOnDate(actor, new Date(args.date)),
  explainStaffAvailability: (actor, args) =>
    tools.explainStaffAvailability(actor, {
      staffId: args.staffId,
      serviceId: args.serviceId,
      startsAt: new Date(args.startsAt),
      locationType: args.locationType as LocationType,
    }),
  getIntegrationStatus: (actor, args) => tools.getIntegrationStatus(actor, args.provider),
  getOutstandingBalance: (actor, args) => tools.getOutstandingBalance(actor, args.appointmentId),
};

const NOT_CONFIGURED_TEXT =
  "The AI Assistant isn't fully set up yet on this deployment - an administrator needs to configure a language model before I can help with questions like this.";
const UNRESOLVED_TEXT = "I wasn't able to work that out. Could you rephrase, or check the relevant page directly?";

export interface AskAssistantInput {
  actor: ActorContext;
  message: string;
  currentPage?: string;
}

export async function askAssistant(input: AskAssistantInput, modelClient: AiModelClient): Promise<{ reply: string }> {
  const businessId = input.actor.businessId!;

  const conversation = await prisma.assistantConversation.upsert({
    where: { businessId_userId: { businessId, userId: input.actor.userId } },
    create: { businessId, userId: input.actor.userId },
    update: {},
  });

  await prisma.assistantMessage.create({
    data: { conversationId: conversation.id, role: "user", text: input.message, pageContext: input.currentPage },
  });

  const recent = await prisma.assistantMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const history: OrchestratorMessage[] = recent
    .reverse()
    .map((m) => ({ role: m.role === "user" ? "staff" : "ai", content: m.text }));

  const toolResultsThisTurn: ToolCallResult[] = [];
  let finalText: string | null = null;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const decision = await modelClient.decide({ businessId, history, toolResultsThisTurn });

    if (decision.kind === "reply") {
      finalText = decision.text;
      break;
    }
    if (decision.kind === "escalate") {
      // The model isn't configured (NotConfiguredAiModelClient always
      // returns this) - there's no human above the owner to hand this off
      // to, so just say so plainly instead of pretending to escalate.
      finalText = NOT_CONFIGURED_TEXT;
      break;
    }

    const fn = TOOL_REGISTRY[decision.tool];
    if (!fn) {
      toolResultsThisTurn.push({ tool: decision.tool, args: decision.args, error: `Unknown tool "${decision.tool}"` });
      continue;
    }
    try {
      const result = await fn(input.actor, decision.args);
      toolResultsThisTurn.push({ tool: decision.tool, args: decision.args, result });
    } catch (err: any) {
      // Includes PermissionDeniedError from assertCan - surfaced to the
      // model as an ordinary tool error, which the system prompt instructs
      // it to relay to the user plainly rather than work around.
      toolResultsThisTurn.push({ tool: decision.tool, args: decision.args, error: err.message });
    }
  }

  if (!finalText) {
    finalText = UNRESOLVED_TEXT;
  }

  await prisma.assistantMessage.create({ data: { conversationId: conversation.id, role: "ai", text: finalText } });

  return { reply: finalText };
}
