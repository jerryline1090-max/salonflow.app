import { useState } from "react";
import {
  useRevenueReport,
  useOutcomeReport,
  usePopularServicesReport,
  useStaffPerformanceReport,
  useClientRetentionReport,
} from "@/hooks/useReports";
import { Card } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { BarList } from "@/components/BarList";
import { Button } from "@/components/Button";
import { formatCurrency } from "@/utils/format";

type RangeOption = "7d" | "30d" | "90d";

const RANGE_LABELS: Record<RangeOption, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
const RANGE_DAYS: Record<RangeOption, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function ReportsPage() {
  const [range, setRange] = useState<RangeOption>("30d");

  const days = RANGE_DAYS[range];

  const revenue = useRevenueReport({ days });
  const outcomes = useOutcomeReport({ days });
  const popularServices = usePopularServicesReport({ days });
  const staffPerformance = useStaffPerformanceReport({ days });
  const retention = useClientRetentionReport();

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Reports</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Built from real appointment and payment data — never a separate set of numbers.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-paper-raised p-1">
          {(Object.keys(RANGE_LABELS) as RangeOption[]).map((r) => (
            <Button key={r} size="sm" variant={range === r ? "primary" : "ghost"} onClick={() => setRange(r)}>
              {RANGE_LABELS[r]}
            </Button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Collected revenue" value={revenue.data ? formatCurrency(revenue.data.totalRevenue) : "—"} />
        <StatCard label="Completed" value={outcomes.data?.completed ?? "—"} />
        <StatCard label="Cancelled" value={outcomes.data?.cancelled ?? "—"} />
        <StatCard label="No-shows" value={outcomes.data?.noShow ?? "—"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-4 font-display text-lg text-ink">Popular services</p>
          {!popularServices.data || popularServices.data.length === 0 ? (
            <p className="text-sm text-ink-muted">No completed appointments in this range yet.</p>
          ) : (
            <BarList
              items={popularServices.data.map((entry) => ({
                label: entry.service?.name ?? "Unknown service",
                value: entry.completedCount,
              }))}
            />
          )}
        </Card>

        <Card className="p-5">
          <p className="mb-1 font-display text-lg text-ink">Staff performance</p>
          <p className="mb-4 text-xs text-ink-muted">Completed service value, not collected payment revenue.</p>
          {!staffPerformance.data || staffPerformance.data.length === 0 ? (
            <p className="text-sm text-ink-muted">No completed appointments in this range yet.</p>
          ) : (
            <BarList
              items={staffPerformance.data.map((entry) => ({
                label: entry.staff?.name ?? "Unknown staff",
                value: entry.completedServiceValue,
                displayValue: `${entry.completedAppointments} visit${entry.completedAppointments === 1 ? "" : "s"} · ${formatCurrency(entry.completedServiceValue)}`,
              }))}
            />
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="mb-4 font-display text-lg text-ink">Client retention</p>
          {!retention.data ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              <StatBlock label="Total clients" value={retention.data.totalClients} />
              <StatBlock label="Returning (2+ visits)" value={retention.data.returning} />
              <StatBlock label="One-time visitors" value={retention.data.oneTime} />
              <StatBlock label="Never completed a visit" value={retention.data.never} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-paper-sunken px-3 py-3 text-center">
      <p className="font-display text-xl text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </div>
  );
}
