import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useAppointments } from "@/hooks/useAppointments";
import { useClients } from "@/hooks/useAppData";
import { useRevenueReport } from "@/hooks/useReports";
import { StatCard } from "@/components/StatCard";
import { NeedsAttentionPanel } from "@/components/NeedsAttentionPanel";
import { AppointmentRow } from "@/components/AppointmentRow";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { RescheduleModal } from "@/components/RescheduleModal";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { BarList } from "@/components/BarList";
import { formatCurrency, formatDate, greetingForHour, startOfDayIso, endOfDayIso } from "@/utils/format";
import type { Appointment } from "@/types";

export function DashboardPage() {
  const { user } = useAuth();
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const today = useAppointments({ from: startOfDayIso(), to: endOfDayIso() });
  const needsAttention = useAppointments({ needsAttention: true });
  const revenue = useRevenueReport({ period: "today" });
  const clients = useClients();
  const todaysAppointments = today.data ?? [];
  const upcomingToday = todaysAppointments.filter((appointment) => appointment.status === "PENDING" || appointment.status === "CONFIRMED");
  const attentionCount = needsAttention.data?.length ?? 0;
  const trend = [["Pending", "PENDING"], ["Confirmed", "CONFIRMED"], ["Completed", "COMPLETED"], ["Cancelled", "CANCELLED"], ["No-show", "NO_SHOW"]].map(([label, status]) => ({ label, value: todaysAppointments.filter((appointment) => appointment.status === status).length }));

  return <PageContainer>
    <PageHeader title={`${greetingForHour()}${user ? `, ${user.name.split(" ")[0]}` : ""}`} description={formatDate(new Date().toISOString())} />
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Today's appointments" value={today.isLoading ? "—" : todaysAppointments.length} />
      <StatCard label="Today's revenue" value={revenue.data ? formatCurrency(revenue.data.totalRevenue) : "—"} />
      <StatCard label="Total clients" value={clients.data?.length ?? "—"} />
      <StatCard label="Upcoming" value={today.isLoading ? "—" : upcomingToday.length} />
    </div>
    <div className="mt-6 flex flex-col">
    {attentionCount > 0 && <section className="order-1" aria-labelledby="attention-heading">
      <div className="mb-3 flex items-center justify-between"><div><h2 id="attention-heading" className="font-display text-lg text-ink">Needs attention</h2><p className="mt-0.5 text-sm text-ink-muted">Resolve past appointments that still need an outcome.</p></div><Link to="/appointments" className="text-sm font-medium text-brass-600 hover:underline">View appointments</Link></div>
      <NeedsAttentionPanel appointments={needsAttention.data ?? []} isLoading={needsAttention.isLoading} onReschedule={setRescheduleTarget} />
    </section>}
    <section className="order-2 mt-6 md:order-3" aria-labelledby="schedule-heading">
      <div className="mb-3"><h2 id="schedule-heading" className="font-display text-lg text-ink">Today’s schedule</h2><p className="mt-0.5 text-sm text-ink-muted">Your pending and confirmed appointments for today.</p></div>
      <Card className="overflow-hidden">
        {today.isLoading ? <div className="space-y-3 p-5">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12" />)}</div> : today.isError ? <Alert tone="error" className="m-5">Today’s schedule could not be loaded.</Alert> : upcomingToday.length === 0 ? <EmptyState title="Nothing left on today’s schedule" description="Every appointment for today is either done or hasn’t been booked yet." /> : <ul className="divide-y divide-line">{upcomingToday.map((appointment) => <AppointmentRow key={appointment.id} appointment={appointment} />)}</ul>}
      </Card>
    </section>
    <section className="order-3 mt-6 md:order-2" aria-labelledby="trend-heading">
      <Card className="p-5"><div className="mb-4"><h2 id="trend-heading" className="font-display text-lg text-ink">Today’s appointment snapshot</h2><p className="mt-0.5 text-sm text-ink-muted">Current appointment outcomes from today’s existing schedule data.</p></div>{today.isLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-8" />)}</div> : trend.every((item) => item.value === 0) ? <p className="text-sm text-ink-muted">No appointments are scheduled today yet.</p> : <BarList items={trend} />}</Card>
    </section>
    </div>
    <RescheduleModal appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />
  </PageContainer>;
}
