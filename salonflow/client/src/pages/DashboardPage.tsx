import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useAppointments, useAppointmentRange, useCalendarContext } from "@/hooks/useAppointments";
import { useClientCount } from "@/hooks/useAppData";
import { useRevenueReport } from "@/hooks/useReports";
import { StatCard } from "@/components/StatCard";
import { NeedsAttentionPanel } from "@/components/NeedsAttentionPanel";
import { AppointmentRow } from "@/components/AppointmentRow";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { RescheduleModal } from "@/components/RescheduleModal";
import { AppointmentDetailModal } from "@/components/AppointmentDetailModal";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { BarList } from "@/components/BarList";
import { formatCurrency, greetingForHour } from "@/utils/format";
import { businessCalendarRange, businessDateKey } from "@/utils/businessCalendar";
import { summarizeDay } from "@/utils/appointmentViews";
import { Button } from "@/components/Button";
import type { Appointment } from "@/types";

export function DashboardPage() {
  const { user } = useAuth();
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const context = useCalendarContext();
  const timezone = context.data?.timezone;
  const today = useAppointmentRange(timezone ? businessCalendarRange(businessDateKey(new Date(), timezone), timezone) : undefined);
  const needsAttention = useAppointments({ needsAttention: true });
  const revenue = useRevenueReport({ period: "today" });
  const clients = useClientCount();
  const todaysAppointments = today.data ?? [];
  const { upcoming: upcomingToday, trend } = summarizeDay(todaysAppointments);
  const dayError = context.isError || today.isError;
  const dayLoading = context.isPending || today.isPending;
  const dayReady = !dayError && !dayLoading;
  const retryDay = () => { void context.refetch(); if (timezone) void today.refetch(); };
  const attentionCount = needsAttention.data?.pagination.total ?? 0;

  return <PageContainer>
    <PageHeader title={`${greetingForHour()}${user ? `, ${user.name.split(" ")[0]}` : ""}`} description={timezone ? `${businessDateKey(new Date(), timezone)} · ${timezone}` : "Loading salon day…"} />
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Today's appointments" value={dayReady ? todaysAppointments.length : "—"} />
      <StatCard label="Today's revenue" value={revenue.data ? formatCurrency(revenue.data.totalRevenue) : "—"} />
      <StatCard label="Total clients" value={clients.data?.count ?? "—"} />
      <StatCard label="Upcoming" value={dayReady ? upcomingToday.length : "—"} />
    </div>
    <div className="mt-6 flex flex-col">
    {attentionCount > 0 && <section className="order-1" aria-labelledby="attention-heading">
      <div className="mb-3 flex items-center justify-between"><div><h2 id="attention-heading" className="font-display text-lg text-ink">Needs attention</h2><p className="mt-0.5 text-sm text-ink-muted">Resolve past appointments that still need an outcome.</p></div><Link to="/appointments" className="text-sm font-medium text-brass-600 hover:underline">View appointments</Link></div>
      <NeedsAttentionPanel appointments={needsAttention.data?.items ?? []} isLoading={needsAttention.isLoading} onReschedule={setRescheduleTarget} />
    </section>}
    <section className="order-2 mt-6 md:order-3" aria-labelledby="schedule-heading">
      <div className="mb-3"><h2 id="schedule-heading" className="font-display text-lg text-ink">Today’s schedule</h2><p className="mt-0.5 text-sm text-ink-muted">Your pending and confirmed appointments for today.</p></div>
      <Card className="overflow-hidden">
        {dayError ? <Alert tone="error" className="m-5">{today.error?.message ?? "Today’s complete schedule could not be loaded."} <Button size="sm" variant="secondary" onClick={retryDay}>Retry</Button></Alert> : dayLoading ? <div className="space-y-3 p-5">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12" />)}</div> : upcomingToday.length === 0 ? <EmptyState title="Nothing left on today’s schedule" description="Every appointment for today is either done or hasn’t been booked yet." /> : <ul className="divide-y divide-line">{upcomingToday.map((appointment) => <AppointmentRow key={appointment.id} appointment={appointment} onClick={() => setDetailId(appointment.id)} />)}</ul>}
      </Card>
    </section>
    <section className="order-3 mt-6 md:order-2" aria-labelledby="trend-heading">
      <Card className="p-5"><div className="mb-4"><h2 id="trend-heading" className="font-display text-lg text-ink">Today’s appointment snapshot</h2><p className="mt-0.5 text-sm text-ink-muted">Current appointment outcomes from today’s existing schedule data.</p></div>{dayError ? <Alert tone="error">Appointment totals are unavailable until the complete day loads.</Alert> : dayLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-8" />)}</div> : trend.every((item) => item.value === 0) ? <p className="text-sm text-ink-muted">No appointments are scheduled today yet.</p> : <BarList items={trend} />}</Card>
    </section>
    </div>
    <RescheduleModal appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />
    <AppointmentDetailModal appointmentId={detailId} onClose={() => setDetailId(null)} onReschedule={() => {
      const appointment = todaysAppointments.find((item) => item.id === detailId);
      if (appointment) {
        setRescheduleTarget(appointment);
        setDetailId(null);
      }
    }} />
  </PageContainer>;
}
