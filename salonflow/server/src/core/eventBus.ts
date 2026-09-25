/**
 * A minimal in-process event bus.
 *
 * WHY THIS EXISTS
 * The architecture requires that things like "notify the client",
 * "notify the assigned staff member", "log to audit trail", and
 * "let the AI Assistant know something changed" all happen as a *reaction*
 * to a core business event — never as logic baked into the core mutation
 * itself. This keeps appointmentService.ts (etc.) focused only on
 * "is this change valid, and what happened", while listeners in
 * notifications/, reports/, and ai/ decide what to do about it.
 *
 * In production this would be backed by a durable queue (e.g. BullMQ/SQS)
 * so a crashed notification worker can't silently lose an event. The
 * interface below is deliberately queue-shaped so swapping the transport
 * later doesn't change any call site.
 */

export type DomainEventName =
  | "appointment.created"
  | "appointment.status_changed"
  | "appointment.rescheduled"
  | "appointment.reassigned"
  | "appointment.cancelled"
  | "appointment.needs_attention"
  | "appointment.attention_resolved"
  | "appointment.completed"
  | "payment.recorded"
  | "payment.outstanding"
  | "staff.removed"
  | "staff.reactivated"
  | "staff.inactive_long_period"
  | "integration.disconnected"
  | "ai.escalation_needed"
  | "conversation.send_failed"
  | "reputation.response_received";

export interface DomainEvent<T = unknown> {
  name: DomainEventName;
  businessId: string;
  payload: T;
  occurredAt: Date;
}

type Handler = (event: DomainEvent) => Promise<void> | void;

class EventBus {
  private handlers = new Map<DomainEventName, Handler[]>();

  on(name: DomainEventName, handler: Handler) {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }

  async emit<T>(name: DomainEventName, businessId: string, payload: T) {
    const event: DomainEvent<T> = { name, businessId, payload, occurredAt: new Date() };
    const list = this.handlers.get(name) ?? [];
    // Handlers run independently — one failing (e.g. WhatsApp API down)
    // must never roll back or block the core business mutation that already
    // committed to the database.
    await Promise.allSettled(list.map((h) => h(event)));
  }
}

export const eventBus = new EventBus();
