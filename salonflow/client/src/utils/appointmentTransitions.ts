import type { AppointmentStatus } from "@/types";

/**
 * Mirrors appointmentStateMachine.ts on the backend. The backend is the
 * real enforcement — this only exists so the UI doesn't offer a button for
 * a transition that would just come back as an error, which is a UX
 * courtesy, not a security boundary.
 */
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW", "PENDING"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function allowedNextStatuses(current: AppointmentStatus): AppointmentStatus[] {
  return ALLOWED_TRANSITIONS[current];
}

export function isTerminalStatus(status: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};
