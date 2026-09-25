import { usePayments } from "@/hooks/usePayments";
import { useRevenueReport } from "@/hooks/useReports";
import { Card } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { formatCurrency, formatDateTime, startOfDayIso, endOfDayIso } from "@/utils/format";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  TRANSFER: "Transfer",
  WALLET: "Wallet",
  OTHER: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  PAID: "text-success",
  PARTIAL: "text-warning",
  UNPAID: "text-danger",
  REFUNDED: "text-ink-muted",
};

export function PaymentsPage() {
  const { data: payments, isLoading } = usePayments();

  const monthStart = new Date();
  monthStart.setDate(1);
  const { data: revenue } = useRevenueReport(startOfDayIso(monthStart), endOfDayIso(new Date()));

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-ink">Payments</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Actual transactions — separate from appointments, but linked to them. A pending appointment is never counted as revenue.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="This month's revenue" value={revenue ? formatCurrency(revenue.totalRevenue) : "—"} />
        <StatCard label="Paid transactions" value={revenue?.paidTransactionCount ?? "—"} />
        <StatCard
          label="Outstanding"
          value={revenue ? formatCurrency(revenue.outstandingAmount) : "—"}
          tone={revenue && revenue.outstandingAmount > 0 ? "warning" : "default"}
        />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-paper-sunken" />
            ))}
          </div>
        ) : !payments || payments.length === 0 ? (
          <EmptyState
            title="No payments recorded yet"
            description="Payments are recorded from an appointment's detail view once a client has paid."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Service</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Method</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-5 py-3 font-medium text-ink">{payment.client?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{payment.appointment?.service?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{formatCurrency(payment.amount)}</td>
                  <td className="px-5 py-3 text-ink-soft">{METHOD_LABELS[payment.method] ?? payment.method}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs ${STATUS_STYLES[payment.status] ?? "text-ink-soft"}`}>
                      {payment.status.charAt(0) + payment.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{formatDateTime(payment.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
