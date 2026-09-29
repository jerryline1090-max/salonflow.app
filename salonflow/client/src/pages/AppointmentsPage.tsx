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
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { PaginationControls } from "@/components/PaginationControls";
import { formatCurrency, formatDateTime } from "@/utils/format";
import type { Appointment, AppointmentStatus } from "@/types";

const STATUS_FILTERS: { label: string; value: AppointmentStatus | "ALL" }[] = [{ label: "All", value: "ALL" }, { label: "Pending", value: "PENDING" }, { label: "Confirmed", value: "CONFIRMED" }, { label: "Completed", value: "COMPLETED" }, { label: "Cancelled", value: "CANCELLED" }, { label: "No-show", value: "NO_SHOW" }];

export function AppointmentsPage() {
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "ALL">("ALL"); const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const [createOpen, setCreateOpen] = useState(false); const [detailId, setDetailId] = useState<string | null>(null); const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const { data: appointmentPage, isLoading, isError } = useAppointments({ ...(statusFilter === "ALL" ? {} : { status: statusFilter }), page });
  const appointments = appointmentPage?.items;
  const filtered = useMemo(() => !appointments ? [] : !search.trim() ? appointments : appointments.filter((appointment) => { const query = search.toLowerCase(); return appointment.client?.name.toLowerCase().includes(query) || appointment.service?.name.toLowerCase().includes(query) || appointment.staff?.name.toLowerCase().includes(query); }), [appointments, search]);
  const openDetail = (appointment: Appointment) => setDetailId(appointment.id);
  return <PageContainer>
    <PageHeader title="Appointments" description="Every booking, whatever channel it came from—one record, one history." actions={<Button onClick={() => setCreateOpen(true)}>New appointment</Button>} />
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin" aria-label="Appointment status filters">{STATUS_FILTERS.map((filter) => <button key={filter.value} type="button" onClick={() => { setStatusFilter(filter.value); setPage(1); }} aria-pressed={statusFilter === filter.value} className={`min-h-10 shrink-0 rounded-md px-3 text-sm ${statusFilter === filter.value ? "bg-ink text-white" : "border border-line bg-surface text-ink-soft hover:bg-paper-sunken"}`}>{filter.label}</button>)}</div><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client, service, or staff…" className="sm:max-w-xs" aria-label="Search appointments on this page" /></div>
    <Card className="overflow-hidden">
      {isLoading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14" />)}</div> : isError ? <Alert tone="error" className="m-5">Appointments could not be loaded.</Alert> : filtered.length === 0 ? <EmptyState title={search || statusFilter !== "ALL" ? "No appointments match" : "No appointments yet"} description={search || statusFilter !== "ALL" ? "Try a different search term or status filter." : "Book the first appointment to get the schedule started."} action={!search && statusFilter === "ALL" ? <Button onClick={() => setCreateOpen(true)}>New appointment</Button> : undefined} /> : <><div className="divide-y divide-line md:hidden">{filtered.map((appointment) => <button key={appointment.id} type="button" onClick={() => openDetail(appointment)} className="w-full px-4 py-4 text-left hover:bg-paper-sunken"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-ink">{appointment.client?.name ?? "Client"}</p><p className="mt-1 text-sm text-ink-soft">{appointment.service?.name} · {appointment.staff?.name}</p></div><StatusBadge status={appointment.status} /></div><div className="mt-2 flex justify-between text-xs text-ink-muted"><span>{formatDateTime(appointment.startsAt)}</span><span className="tabular-nums">{formatCurrency(appointment.priceSnapshot)}</span></div></button>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted"><th className="px-5 py-3">Client</th><th className="px-5 py-3">Service</th><th className="px-5 py-3">Staff</th><th className="px-5 py-3">Date &amp; time</th><th className="px-5 py-3">Price</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-line">{filtered.map((appointment) => <tr key={appointment.id} className="hover:bg-paper-sunken"><td className="px-5 py-3"><button type="button" onClick={() => openDetail(appointment)} className="font-medium text-ink hover:underline">{appointment.client?.name}</button></td><td className="px-5 py-3 text-ink-soft">{appointment.service?.name}</td><td className="px-5 py-3 text-ink-soft">{appointment.staff?.name}</td><td className="px-5 py-3 text-ink-soft">{formatDateTime(appointment.startsAt)}</td><td className="px-5 py-3 tabular-nums text-ink-soft">{formatCurrency(appointment.priceSnapshot)}</td><td className="px-5 py-3"><StatusBadge status={appointment.status} /></td></tr>)}</tbody></table></div></>}
    </Card>
    {appointmentPage && <PaginationControls page={appointmentPage.pagination.page} totalPages={appointmentPage.pagination.totalPages} onPageChange={setPage} />}
    <CreateAppointmentModal open={createOpen} onClose={() => setCreateOpen(false)} /><AppointmentDetailModal appointmentId={detailId} onClose={() => setDetailId(null)} onReschedule={() => { const appointment = appointments?.find((item) => item.id === detailId); if (appointment) { setRescheduleTarget(appointment); setDetailId(null); } }} /><RescheduleModal appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />
  </PageContainer>;
}
