import { prisma } from "../../lib/prisma";
import { eventBus } from "../../core/eventBus";

/**
 * Section 15–16: notifications are event-driven reactions, registered once
 * here at startup (see src/index.ts), not scattered as side-effect code
 * inside appointmentService.ts. This keeps the core mutation logic honest —
 * it only decides "is this a valid change", never "who should be pinged".
 */
export function registerNotificationListeners() {
  eventBus.on("appointment.created", async (event) => {
    const { appointment } = event.payload as any;
    await notify(event.businessId, {
      type: "APPOINTMENT_CREATED",
      priority: "NORMAL",
      audience: "STAFF_MEMBER",
      audienceUserId: undefined,
      appointmentId: appointment.id,
      title: "New appointment assigned to you",
      body: `A new appointment has been booked. Client, service, date, time and location are on the appointment.`,
    });
  });

  eventBus.on("appointment.reassigned", async (event) => {
    const { appointment, previousStaffId, reason } = event.payload as any;
    await notify(event.businessId, {
      type: "STAFF_REASSIGNED",
      priority: "HIGH",
      audience: "CLIENT",
      appointmentId: appointment.id,
      title: "Your appointment has been updated",
      body: reason
        ? `Your appointment has been reassigned. ${reason}`
        : `Your appointment has been reassigned to a different staff member.`,
    });
    await notify(event.businessId, {
      type: "STAFF_REASSIGNED",
      priority: "NORMAL",
      audience: "STAFF_MEMBER",
      appointmentId: appointment.id,
      title: "Appointment reassigned to you",
      body: `An appointment was reassigned to you from another staff member.`,
    });
  });

  eventBus.on("appointment.needs_attention", async (event) => {
    const { appointmentId, clientName, reason } = event.payload as any;
    await notify(event.businessId, {
      type: "APPOINTMENT_NEEDS_ATTENTION",
      priority: "HIGH",
      audience: "OWNER",
      appointmentId,
      title: "Appointment needs attention",
      body: `${clientName}'s appointment ${reason}`,
      actionRequired: true,
    });
  });

  eventBus.on("appointment.cancelled", async (event) => {
    const { appointment } = event.payload as any;
    await notify(event.businessId, {
      type: "APPOINTMENT_CANCELLED",
      priority: "NORMAL",
      audience: "STAFF_MEMBER",
      appointmentId: appointment.id,
      title: "Appointment cancelled",
      body: "An appointment on your schedule was cancelled.",
    });
  });

  eventBus.on("payment.recorded", async (event) => {
    const { payment } = event.payload as any;
    await notify(event.businessId, {
      type: "PAYMENT_RECEIVED",
      priority: "LOW",
      audience: "OWNER",
      title: "Payment received",
      body: `A payment of ${payment.amount} was recorded.`,
    });
  });

  eventBus.on("staff.removed", async (event) => {
    const { staffName, affectedCount } = event.payload as any;
    await notify(event.businessId, {
      type: "STAFF_REASSIGNED",
      priority: "URGENT",
      audience: "OWNER",
      title: `${staffName} has ${affectedCount} upcoming appointment${affectedCount === 1 ? "" : "s"}`,
      body: "Review and reassign these appointments to a qualified staff member.",
      actionRequired: true,
    });
  });

  eventBus.on("integration.disconnected", async (event) => {
    const { provider } = event.payload as any;
    await notify(event.businessId, {
      type: "INTEGRATION_DISCONNECTED",
      priority: "URGENT",
      audience: "OWNER",
      title: `${provider} disconnected`,
      body: "Reconnect this integration to keep the AI Receptionist working on this channel.",
      actionRequired: true,
    });
  });

  eventBus.on("conversation.send_failed", async (event) => {
    const { channel, error } = event.payload as any;
    await notify(event.businessId, {
      type: "INTEGRATION_DISCONNECTED",
      priority: "HIGH",
      audience: "OWNER",
      title: `Couldn't send a ${channel} reply`,
      body: error ? `The AI Receptionist's reply failed to send: ${error}` : "The AI Receptionist's reply failed to send.",
      actionRequired: true,
    });
  });

  eventBus.on("reputation.response_received", async (event) => {
    const { sentiment, rating, feedbackText } = event.payload as any;
    // Section 30's central rule: unhappy or ambiguous feedback goes to the
    // owner privately — the exact same notification system as everything
    // else, no separate "reviews inbox" mechanism. A happy response gets a
    // quiet, low-priority note; nothing here ever pushes toward or
    // fabricates a public review on the salon's behalf.
    if (sentiment === "HAPPY") {
      await notify(event.businessId, {
        type: "REPUTATION_FEEDBACK_RECEIVED",
        priority: "LOW",
        audience: "OWNER",
        title: "Happy client feedback",
        body: rating ? `A client rated their visit ${rating}/5.` : "A client left positive feedback.",
      });
      return;
    }
    await notify(event.businessId, {
      type: "REPUTATION_FEEDBACK_RECEIVED",
      priority: "HIGH",
      audience: "OWNER",
      title: sentiment === "UNHAPPY" ? "Unhappy client feedback needs follow-up" : "Client feedback needs a look",
      body: feedbackText ? `"${feedbackText}"` : "A client responded to a feedback request.",
      actionRequired: true,
    });
  });

  eventBus.on("ai.escalation_needed", async (event) => {
    const { question } = event.payload as any;
    await notify(event.businessId, {
      type: "AI_NEEDS_HUMAN",
      priority: "HIGH",
      audience: "OWNER",
      title: "AI Receptionist needs your help",
      body: `A client asked: "${question}". The AI didn't have a confident answer.`,
      actionRequired: true,
    });
  });
}

interface NotifyInput {
  type: any;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  audience: "OWNER" | "MANAGER" | "STAFF_MEMBER" | "CLIENT";
  audienceUserId?: string;
  appointmentId?: string;
  title: string;
  body: string;
  actionRequired?: boolean;
}

async function notify(businessId: string, input: NotifyInput) {
  return prisma.notification.create({
    data: {
      businessId,
      appointmentId: input.appointmentId,
      type: input.type,
      priority: input.priority,
      audience: input.audience,
      audienceUserId: input.audienceUserId,
      title: input.title,
      body: input.body,
      actionRequired: input.actionRequired ?? false,
    },
  });
}
