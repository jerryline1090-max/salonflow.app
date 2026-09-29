import type { Appointment } from "@/types";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatTime } from "@/utils/format";

export function AppointmentRow({ appointment, onClick }: { appointment: Appointment; onClick?: () => void }) {
  const interactiveProps = onClick ? {
    "aria-label": `View appointment for ${appointment.client?.name ?? "client"}`,
    onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    },
    role: "button" as const,
    tabIndex: 0,
  } : {};

  return (
    <li
      {...interactiveProps}
      onClick={onClick}
      className={`flex items-center justify-between gap-4 px-5 py-3 ${onClick ? "cursor-pointer hover:bg-paper-sunken focus-visible:bg-brass-50" : ""}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-16 shrink-0 text-sm font-medium text-ink-soft tabular-nums">{formatTime(appointment.startsAt)}</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{appointment.client?.name ?? "Client"}</p>
          <p className="truncate text-xs text-ink-muted">
            {appointment.service?.name ?? "Service"} · {appointment.staff?.name ?? "Staff"}
            {appointment.locationType === "HOME" ? " · Home visit" : ""}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm text-ink-muted tabular-nums">{formatCurrency(appointment.priceSnapshot)}</span>
        <StatusBadge status={appointment.status} />
      </div>
    </li>
  );
}
