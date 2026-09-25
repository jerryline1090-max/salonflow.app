import type { AppointmentStatus } from "@/types";

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; dot: string; text: string; bg: string }> = {
  PENDING: { label: "Pending", dot: "bg-warning", text: "text-warning", bg: "bg-warning-bg" },
  CONFIRMED: { label: "Confirmed", dot: "bg-info", text: "text-info", bg: "bg-info-bg" },
  COMPLETED: { label: "Completed", dot: "bg-success", text: "text-success", bg: "bg-success-bg" },
  CANCELLED: { label: "Cancelled", dot: "bg-ink-muted", text: "text-ink-muted", bg: "bg-paper-sunken" },
  NO_SHOW: { label: "No-show", dot: "bg-danger", text: "text-danger", bg: "bg-danger-bg" },
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}
