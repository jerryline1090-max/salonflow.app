import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Appointment } from "@/types";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { formatDateTime } from "@/utils/format";
import { useChangeAppointmentStatus } from "@/hooks/useAppointments";
import { api } from "@/api/client";

interface NeedsAttentionPanelProps {
  appointments: Appointment[];
  isLoading: boolean;
  onReschedule: (appointment: Appointment) => void;
}

/**
 * Section 7, made real: SalonFlow never silently decides a stale pending
 * appointment is "completed". It flags it here and offers the owner
 * exactly the resolutions the spec describes — nothing on this panel picks
 * one automatically.
 */
export function NeedsAttentionPanel({ appointments, isLoading, onReschedule }: NeedsAttentionPanelProps) {
  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="h-5 w-40 animate-pulse rounded bg-paper-sunken" />
      </Card>
    );
  }

  if (appointments.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing needs your attention" description="Every past appointment has a resolved status. Nice and tidy." />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-warning-bg/50 px-5 py-3">
        <p className="text-sm font-medium text-warning">
          {appointments.length} appointment{appointments.length === 1 ? "" : "s"} need{appointments.length === 1 ? "s" : ""} your attention
        </p>
      </div>
      <ul className="divide-y divide-line">
        {appointments.map((appt) => (
          <AttentionRow key={appt.id} appointment={appt} onReschedule={() => onReschedule(appt)} />
        ))}
      </ul>
    </Card>
  );
}

function AttentionRow({ appointment, onReschedule }: { appointment: Appointment; onReschedule: () => void }) {
  const changeStatus = useChangeAppointmentStatus();
  const queryClient = useQueryClient();
  const [acknowledging, setAcknowledging] = useState(false);

  async function handleKeepPending() {
    setAcknowledging(true);
    try {
      await api.post(`/appointments/${appointment.id}/acknowledge-attention`);
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    } finally {
      setAcknowledging(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <p className="text-sm text-ink">
        <span className="font-medium">{appointment.client?.name ?? "A client"}</span>'s appointment was scheduled for{" "}
        {formatDateTime(appointment.startsAt)} but is still {appointment.status.toLowerCase()}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => changeStatus.mutate({ id: appointment.id, newStatus: "COMPLETED" })}>
          Mark completed
        </Button>
        <Button size="sm" variant="secondary" onClick={() => changeStatus.mutate({ id: appointment.id, newStatus: "CANCELLED" })}>
          Cancelled
        </Button>
        <Button size="sm" variant="secondary" onClick={() => changeStatus.mutate({ id: appointment.id, newStatus: "NO_SHOW" })}>
          No-show
        </Button>
        <Button size="sm" variant="secondary" onClick={onReschedule}>
          Reschedule
        </Button>
        <Button size="sm" variant="ghost" loading={acknowledging} onClick={handleKeepPending}>
          Keep pending
        </Button>
      </div>
    </li>
  );
}
