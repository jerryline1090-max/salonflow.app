/**
 * These schemas are what actually gets sent to Claude's Messages API
 * `tools` parameter. The `name` of each MUST exactly match a key in
 * `TOOL_REGISTRY` (receptionistOrchestrator.ts) — that registry is what
 * turns a tool_use block back into a real call against receptionistTools.ts.
 *
 * `escalate_to_staff` is the one exception: it's presented to the model as
 * an ordinary tool, but claudeModelClient.ts intercepts it and returns a
 * `{ kind: "escalate" }` decision instead of routing it through the
 * registry — escalation is a decision *kind* in aiModelClient.ts, not a
 * business-logic tool call.
 */

export const ESCALATE_TOOL_NAME = "escalate_to_staff";

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export const RECEPTIONIST_TOOL_SCHEMAS: AnthropicToolSchema[] = [
  {
    name: "searchServices",
    description: "Search this salon's service catalog by name/category. Call with no query to list everything offered.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Free-text search, e.g. 'braids'" } } },
  },
  {
    name: "getService",
    description: "Get full details (price, duration, salon/home availability) for one specific service by its ID.",
    input_schema: { type: "object", properties: { serviceId: { type: "string" } }, required: ["serviceId"] },
  },
  {
    name: "getBusinessHours",
    description: "Get this salon's weekly opening hours.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "findQualifiedStaffForService",
    description: "List active staff members qualified to perform a given service.",
    input_schema: { type: "object", properties: { serviceId: { type: "string" } }, required: ["serviceId"] },
  },
  {
    name: "checkSlotAvailability",
    description: "Check whether a specific staff member is actually available for a specific service at a specific start time.",
    input_schema: {
      type: "object",
      properties: {
        staffId: { type: "string" },
        serviceId: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601 datetime" },
        locationType: { type: "string", enum: ["SALON", "HOME"] },
      },
      required: ["staffId", "serviceId", "startsAt", "locationType"],
    },
  },
  {
    name: "suggestNextAvailableSlots",
    description:
      "Find real upcoming open slots for a service — use this whenever a requested time is unavailable, instead of just saying 'no availability'.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        locationType: { type: "string", enum: ["SALON", "HOME"] },
        staffId: { type: "string", description: "Optional — omit to consider any qualified staff member" },
        fromDate: { type: "string", description: "ISO 8601 date to start searching from; defaults to now" },
      },
      required: ["serviceId", "locationType"],
    },
  },
  {
    name: "bookAppointment",
    description: "Book a new appointment for this client. Only call this after confirming the slot is available and the client has agreed.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        staffId: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601 datetime" },
        locationType: { type: "string", enum: ["SALON", "HOME"] },
        homeAddress: { type: "string", description: "Required if locationType is HOME" },
        notes: { type: "string" },
      },
      required: ["serviceId", "staffId", "startsAt", "locationType"],
    },
  },
  {
    name: "getOwnAppointment",
    description: "Look up one of this client's own appointments by ID.",
    input_schema: { type: "object", properties: { appointmentId: { type: "string" } }, required: ["appointmentId"] },
  },
  {
    name: "listOwnUpcomingAppointments",
    description: "List this client's own upcoming pending/confirmed appointments.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "rescheduleOwnAppointment",
    description: "Move one of this client's own appointments to a new time. Confirm the new slot is available first.",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" }, newStartsAt: { type: "string", description: "ISO 8601 datetime" } },
      required: ["appointmentId", "newStartsAt"],
    },
  },
  {
    name: "cancelOwnAppointment",
    description: "Cancel one of this client's own appointments.",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" }, reason: { type: "string" } },
      required: ["appointmentId"],
    },
  },
  {
    name: "answerFromKnowledge",
    description:
      "Answer a general question (policies, products, promotions, parking, etc.) from this salon's own knowledge base. Returns 'not answered' if nothing matches — do not make something up if it does.",
    input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
  },
  {
    name: ESCALATE_TOOL_NAME,
    description:
      "Hand this conversation off to a human member of staff. Use this whenever you don't have a confident, grounded answer, the client explicitly asks for a human, or the request needs approval you can't give.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
];
