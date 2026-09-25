import { AppointmentStatus } from "@prisma/client";

/**
 * Explicit allowed transitions. Anything not listed here is rejected —
 * this is what stops, e.g., a COMPLETED appointment from being silently
 * flipped back to PENDING, or a CANCELLED one from being "confirmed".
 *
 * Every transition in this table must be triggered by an explicit actor
 * decision (owner, manager, staff, or an unambiguous system rule — see
 * attentionScanner.ts, which flags rather than transitions). There is no
 * transition here that a background job performs on its own.
 */
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW", "PENDING"],
  COMPLETED: [], // terminal — completion is a fact, not reversible via normal flow
  CANCELLED: [], // terminal
  NO_SHOW: [], // terminal
};

export function isTransitionAllowed(from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === to) return false; // no-op transitions aren't "changes"
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: AppointmentStatus, to: AppointmentStatus) {
    super(`Cannot change appointment status from ${from} to ${to}`);
    this.name = "InvalidStatusTransitionError";
  }
}
