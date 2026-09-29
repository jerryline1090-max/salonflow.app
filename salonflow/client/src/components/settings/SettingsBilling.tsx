import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { subscriptionApi } from "@/api/resources";
import { Card } from "@/components/Card";
import { Alert } from "@/components/Alert";
import { formatCurrency } from "@/utils/format";

export function SettingsBilling() {
  const { user } = useAuth();
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: subscriptionApi.get, enabled: user?.role === "OWNER" });
  if (user?.role !== "OWNER") return null;
  if (subscription.isError) return <Alert tone="error">Billing details could not be loaded.</Alert>;
  const details = subscription.data;
  const data = details ?? user.subscription;
  if (!data) return <Alert tone="warning">Subscription details are temporarily unavailable. Please contact SalonFlow support.</Alert>;
  const price = details?.monthlyPriceMinor !== undefined ? formatCurrency(details.monthlyPriceMinor) : null;
  return <Card className="p-5"><div className="mb-4"><h2 className="font-display text-xl text-ink">Billing</h2><p className="mt-1 text-sm text-ink-muted">Read-only subscription status. Checkout and plan changes are not available yet.</p></div>
    <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-ink-muted">Current plan</dt><dd className="mt-1 font-medium text-ink">{details?.displayName ?? data.planCode}</dd></div><div><dt className="text-ink-muted">Monthly price</dt><dd className="mt-1 font-medium text-ink">{price ? `${price}/month` : "—"}</dd></div><div><dt className="text-ink-muted">Status</dt><dd className="mt-1 font-medium text-ink">{data.status.replace(/_/g, " ")}</dd></div>{data.trialEndsAt && <div><dt className="text-ink-muted">Trial ends</dt><dd className="mt-1 font-medium text-ink">{new Date(data.trialEndsAt).toLocaleDateString()} {data.trialDaysRemaining !== null ? `(${data.trialDaysRemaining} days remaining)` : ""}</dd></div>}{data.graceEndsAt && <div><dt className="text-ink-muted">Grace period ends</dt><dd className="mt-1 font-medium text-ink">{new Date(data.graceEndsAt).toLocaleDateString()}</dd></div>}{data.currentPeriodEndsAt && <div><dt className="text-ink-muted">Current period ends</dt><dd className="mt-1 font-medium text-ink">{new Date(data.currentPeriodEndsAt).toLocaleDateString()}</dd></div>}<div><dt className="text-ink-muted">Cancellation</dt><dd className="mt-1 font-medium text-ink">{data.cancelAtPeriodEnd ? "Scheduled at period end" : "Not scheduled"}</dd></div></dl>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">{[["Starter", "₦10,000/month"], ["Growth", "₦15,000/month"], ["Pro", "₦25,000/month"]].map(([name, amount]) => <div key={name} className="rounded border border-line p-3"><p className="font-medium text-ink">{name}</p><p className="mt-1 text-sm text-ink-muted">{amount}</p><p className="mt-2 text-xs text-ink-muted">Plan changes coming later</p></div>)}</div>
  </Card>;
}
