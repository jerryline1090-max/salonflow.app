import { usePayments } from "@/hooks/usePayments";
import { useRevenueReport } from "@/hooks/useReports";
import { Card } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { formatCurrency, formatDateTime, startOfDayIso, endOfDayIso } from "@/utils/format";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { PaginationControls } from "@/components/PaginationControls";
import { useState } from "react";

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
  const [page, setPage] = useState(1);
  const { data: paymentPage, isLoading, isError } = usePayments(page);
  const payments = paymentPage?.items;

  const { data: revenue } = useRevenueReport({ period: "current-month" });

  return (
    <PageContainer><PageHeader title="Payments" description="Salon client transactions. This is separate from any future SalonFlow subscription billing." />

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
          <div className="space-y-3 p-5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : isError ? <Alert tone="error" className="m-5">Payments could not be loaded.</Alert>
        : !payments || payments.length === 0 ? (
          <EmptyState
            title="No payments recorded yet"
            description="Payments are recorded from an appointment's detail view once a client has paid."
          />
        ) : (<><div className="divide-y divide-line md:hidden">{payments.map((payment) => <div key={payment.id} className="px-4 py-4"><div className="flex justify-between gap-3"><p className="font-medium text-ink">{payment.client?.name ?? "Client"}</p><p className="tabular-nums text-ink">{formatCurrency(payment.amount)}</p></div><p className="mt-1 text-sm text-ink-soft">{METHOD_LABELS[payment.method] ?? payment.method} · {formatDateTime(payment.createdAt)}</p><p className={`mt-1 text-xs ${STATUS_STYLES[payment.status] ?? "text-ink-soft"}`}>{payment.status.charAt(0) + payment.status.slice(1).toLowerCase()}</p></div>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
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
          </table></div></>)}
      </Card>
      {paymentPage && <PaginationControls page={paymentPage.pagination.page} totalPages={paymentPage.pagination.totalPages} onPageChange={setPage} />}
    </PageContainer>
  );
}
