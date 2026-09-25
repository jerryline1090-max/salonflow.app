import { AnthropicToolSchema } from "./toolSchemas";

/**
 * Unlike the Receptionist's fixed, narrow allowlist (receptionistTools.ts —
 * appropriate for an anonymous external client), the Assistant's tools
 * mirror the dashboard itself: reports, appointment search/actions, staff
 * availability, client stats, integration status. The safety boundary
 * here isn't "a small allowlist" — it's that EVERY one of these tool
 * implementations (assistantTools.ts) calls the same `assertCan()` the
 * REST routes use, for the real logged-in user. A STAFF user's model
 * session literally cannot call `getRevenueReport` successfully, the same
 * way their dashboard has no Reports link to click.
 */
export const ASSISTANT_TOOL_SCHEMAS: AnthropicToolSchema[] = [
  {
    name: "searchAppointments",
    description: "Search appointments by client name, staff name, date range, and/or status. Returns up to 20 matches.",
    input_schema: {
      type: "object",
      properties: {
        clientName: { type: "string" },
        staffName: { type: "string" },
        dateFrom: { type: "string", description: "ISO 8601 date/datetime" },
        dateTo: { type: "string", description: "ISO 8601 date/datetime" },
        status: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] },
      },
    },
  },
  {
    name: "getAppointment",
    description: "Get full details for one specific appointment by ID.",
    input_schema: { type: "object", properties: { appointmentId: { type: "string" } }, required: ["appointmentId"] },
  },
  {
    name: "moveAppointment",
    description: "Reschedule an appointment to a new start time. Confirm the specific appointment and new time with the user before calling this.",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" }, newStartsAt: { type: "string", description: "ISO 8601 datetime" } },
      required: ["appointmentId", "newStartsAt"],
    },
  },
  {
    name: "changeAppointmentStatus",
    description: "Change an appointment's status (e.g. mark completed, cancelled, no-show). Confirm with the user before calling this.",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        newStatus: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] },
        reason: { type: "string" },
      },
      required: ["appointmentId", "newStatus"],
    },
  },
  {
    name: "reassignAppointment",
    description: "Reassign an appointment to a different staff member. Owner/manager action only. Confirm with the user before calling this.",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" }, newStaffId: { type: "string" }, reason: { type: "string" } },
      required: ["appointmentId", "newStaffId"],
    },
  },
  {
    name: "getRevenueReport",
    description: "Total revenue and outstanding amounts for a date range.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "ISO 8601 date" }, to: { type: "string", description: "ISO 8601 date" } },
      required: ["from", "to"],
    },
  },
  {
    name: "getAppointmentOutcomeReport",
    description: "Counts of completed/cancelled/no-show appointments, and how many currently need attention, for a date range.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "getPopularServicesReport",
    description: "Which services had the most completed appointments in a date range.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  },
  {
    name: "getStaffPerformanceReport",
    description: "Completed appointment counts and revenue generated per staff member for a date range.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  },
  {
    name: "getClientRetentionReport",
    description: "How many clients are returning (2+ completed visits) vs one-time vs never-completed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getClientCount",
    description: "Total number of clients on file for this business.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getClientStats",
    description: "Visit count, cancellations, no-shows, and total spend for one specific client.",
    input_schema: { type: "object", properties: { clientId: { type: "string" } }, required: ["clientId"] },
  },
  {
    name: "listStaffAvailableOnDate",
    description: "List active staff members scheduled to work on a given date, with their working hours.",
    input_schema: { type: "object", properties: { date: { type: "string", description: "ISO 8601 date" } }, required: ["date"] },
  },
  {
    name: "explainStaffAvailability",
    description: "Explain why a specific staff member is or isn't available for a specific service at a specific time — use this for 'why can't I book X' questions.",
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
    name: "getIntegrationStatus",
    description: "Check whether WhatsApp or Instagram is connected for this business.",
    input_schema: { type: "object", properties: { provider: { type: "string", enum: ["whatsapp", "instagram"] } }, required: ["provider"] },
  },
  {
    name: "getOutstandingBalance",
    description: "Outstanding payment balance for a specific appointment.",
    input_schema: { type: "object", properties: { appointmentId: { type: "string" } }, required: ["appointmentId"] },
  },
];
