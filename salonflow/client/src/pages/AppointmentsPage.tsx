import { useMemo, useState } from "react";
import { useAppointments } from "@/hooks/useAppointments";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { CreateAppointmentModal } from "@/components/CreateAppointmentModal";
import { AppointmentDetailModal } from "@/components/AppointmentDetailModal";
import { RescheduleModal } from "@/components/RescheduleModal";
import { formatCurrency, formatDateTime } from "@/utils/format";
import type { Appointment, AppointmentStatus } from "@/types";

const STATUS_FILTERS: { label: string; value: AppointmentStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "No-show", value: "NO_SHOW" },
];

export function AppointmentsPage() {
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);

  const { data: appointments, isLoading } = useAppointments(statusFilter === "ALL" ? undefined : { status: statusFilter });

  const filtered = useMemo(() => {
    if (!appointments) return [];
    if (!search.trim()) return appointments;
    const q = search.toLowerCase();
    return appointments.filter(
      (a) => a.client?.name.toLowerCase().includes(q) || a.service?.name.toLowerCase().includes(q) || a.staff?.name.toLowerCase().includes(q)
    );
  }, [appointments, search]);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Appointments</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Every booking, whatever channel it came from — one record, one history.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New appointment</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-paper-raised p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                statusFilter === f.value ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-sunken"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, service, or staff…"
          className="max-w-xs"
        />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-paper-sunken" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search || statusFilter !== "ALL" ? "No appointments match" : "No appointments yet"}
            description={
              search || statusFilter !== "ALL"
                ? "Try a different search term or status filter."
                : "Book the first appointment to get the schedule started."
            }
            action={!search && statusFilter === "ALL" ? <Button onClick={() => setCreateOpen(true)}>New appointment</Button> : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Service</th>
                <th className="px-5 py-3 font-medium">Staff</th>
                <th className="px-5 py-3 font-medium">Date &amp; time</th>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((appt) => (
                <tr key={appt.id} onClick={() => setDetailId(appt.id)} className="cursor-pointer hover:bg-paper-sunken">
                  <td className="px-5 py-3 font-medium text-ink">{appt.client?.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{appt.service?.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{appt.staff?.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{formatDateTime(appt.startsAt)}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{formatCurrency(appt.priceSnapshot)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={appt.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CreateAppointmentModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <AppointmentDetailModal
        appointmentId={detailId}
        onClose={() => setDetailId(null)}
        onReschedule={() => {
          const appt = appointments?.find((a) => a.id === detailId);
          if (appt) {
            setRescheduleTarget(appt);
            setDetailId(null);
          }
        }}
      />
      <RescheduleModal appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />
    </div>
  );
}
