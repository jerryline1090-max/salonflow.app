import { useState } from "react";
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
import { formatCurrency, formatDate, greetingForHour, startOfDayIso, endOfDayIso } from "@/utils/format";
import type { Appointment } from "@/types";

export function DashboardPage() {
  const { user } = useAuth();
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);

  const from = startOfDayIso();
  const to = endOfDayIso();

  const today = useAppointments({ from, to });
  const needsAttention = useAppointments({ needsAttention: true });
  const revenue = useRevenueReport(from, to);
  const clients = useClients();

  const todaysAppointments = today.data ?? [];
  const upcomingToday = todaysAppointments.filter((a) => a.status === "PENDING" || a.status === "CONFIRMED");

  return (
    <div className="max-w-6xl p-4 sm:p-8">
      <header className="mb-8">
        <p className="font-display text-3xl text-ink">
          {greetingForHour()}
          {user ? `, ${user.name.split(" ")[0]}` : ""}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{formatDate(new Date().toISOString())}</p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Today's appointments" value={todaysAppointments.length} />
        <StatCard
          label="Needs attention"
          value={needsAttention.data?.length ?? 0}
          tone={(needsAttention.data?.length ?? 0) > 0 ? "warning" : "default"}
        />
        <StatCard label="Today's revenue" value={revenue.data ? formatCurrency(revenue.data.totalRevenue) : "—"} />
        <StatCard label="Total clients" value={clients.data?.length ?? "—"} />
      </div>

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 font-display text-lg text-ink">Needs attention</h2>
          <NeedsAttentionPanel
            appointments={needsAttention.data ?? []}
            isLoading={needsAttention.isLoading}
            onReschedule={setRescheduleTarget}
          />
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg text-ink">Today's schedule</h2>
          <Card className="overflow-hidden">
            {today.isLoading ? (
              <div className="space-y-3 p-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-paper-sunken" />
                ))}
              </div>
            ) : upcomingToday.length === 0 ? (
              <EmptyState
                title="Nothing left on today's schedule"
                description="Every appointment for today is either done or hasn't been booked yet."
              />
            ) : (
              <ul className="divide-y divide-line">
                {upcomingToday.map((appt) => (
                  <AppointmentRow key={appt.id} appointment={appt} />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <RescheduleModal appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />
    </div>
  );
}
