import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { subscriptionApi } from "@/api/resources";
import { ApiError } from "@/api/client";
import { Card } from "@/components/Card";
import { Alert } from "@/components/Alert";
import { formatCurrency } from "@/utils/format";

export function SettingsBilling() {
  const { user } = useAuth();
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: subscriptionApi.get, enabled: user?.role === "OWNER" });
  const history = useQuery({ queryKey: ["billing-history"], queryFn: subscriptionApi.history, enabled: user?.role === "OWNER" });
  const checkout = useMutation({ mutationFn: subscriptionApi.checkout, onSuccess: ({ authorizationUrl }) => { window.location.assign(authorizationUrl); } });
  const cancel = useMutation({ mutationFn: subscriptionApi.cancel, onSuccess: () => subscription.refetch() });
  const undoCancel = useMutation({ mutationFn: subscriptionApi.undoCancel, onSuccess: () => subscription.refetch() });
  if (user?.role !== "OWNER") return null;
  if (subscription.isError) return <Alert tone="error">Billing details could not be loaded.</Alert>;
  const details = subscription.data;
  const data = details ?? user.subscription;
  if (!data) return <Alert tone="warning">Subscription details are temporarily unavailable. Please contact SalonFlow support.</Alert>;
  const price = details?.monthlyPriceMinor !== undefined ? formatCurrency(details.monthlyPriceMinor) : null;
  const checkoutError = checkout.error instanceof ApiError && checkout.error.message.includes("Existing recurring billing requires reconciliation")
    ? "This subscription already has an existing payment subscription and cannot start a new recurring checkout yet."
    : "Checkout could not be started.";
  const statusMessage = data.status === "PAST_DUE" ? "Payment needs attention. Your salon remains available while you recover billing." : data.status === "SUSPENDED" ? "Salon tools are restricted until a verified payment is received." : data.status === "GRACE_PERIOD" ? "Your trial has ended and the grace period is active." : data.status === "CANCELLED" ? "Cancellation is effective. Start checkout to restore service after verified payment." : "Your status updates only after verified payment confirmation.";
  return <Card className="p-5"><div className="mb-4"><h2 className="font-display text-xl text-ink">Billing</h2><p className="mt-1 text-sm text-ink-muted">{statusMessage}</p></div>
    <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-ink-muted">Current plan</dt><dd className="mt-1 font-medium text-ink">{details?.displayName ?? data.planCode}</dd></div><div><dt className="text-ink-muted">Monthly price</dt><dd className="mt-1 font-medium text-ink">{price ? `${price}/month` : "—"}</dd></div><div><dt className="text-ink-muted">Status</dt><dd className="mt-1 font-medium text-ink">{data.status.replace(/_/g, " ")}</dd></div>{data.trialEndsAt && <div><dt className="text-ink-muted">Trial ends</dt><dd className="mt-1 font-medium text-ink">{new Date(data.trialEndsAt).toLocaleDateString()} {data.trialDaysRemaining !== null ? `(${data.trialDaysRemaining} days remaining)` : ""}</dd></div>}{data.graceEndsAt && <div><dt className="text-ink-muted">Grace period ends</dt><dd className="mt-1 font-medium text-ink">{new Date(data.graceEndsAt).toLocaleDateString()}</dd></div>}{data.currentPeriodEndsAt && <div><dt className="text-ink-muted">Current period ends</dt><dd className="mt-1 font-medium text-ink">{new Date(data.currentPeriodEndsAt).toLocaleDateString()}</dd></div>}<div><dt className="text-ink-muted">Cancellation</dt><dd className="mt-1 font-medium text-ink">{data.cancelAtPeriodEnd ? "Scheduled at period end" : "Not scheduled"}</dd></div></dl>
    {data.cancelAtPeriodEnd ? <div className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-ink">Cancellation is scheduled{data.currentPeriodEndsAt ? `; access continues through ${new Date(data.currentPeriodEndsAt).toLocaleDateString()}.` : "; provider period timing is not yet confirmed."}<button className="ml-3 underline" disabled={undoCancel.isPending} onClick={() => undoCancel.mutate()}>Undo cancellation</button></div> : (data.status === "ACTIVE" || data.status === "PAST_DUE") && <button className="mt-5 text-sm underline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Schedule cancellation at period end</button>}
    {checkout.isError && <Alert tone="error">{checkoutError}</Alert>}<div className="mt-5 grid gap-3 sm:grid-cols-3">{[["STARTER", "Starter", "₦10,000/month"], ["GROWTH", "Growth", "₦15,000/month"], ["PRO", "Pro", "₦25,000/month"]].map(([code, name, amount]) => <div key={code} className="rounded border border-line p-3"><p className="font-medium text-ink">{name}</p><p className="mt-1 text-sm text-ink-muted">{amount}</p><button type="button" disabled={checkout.isPending} onClick={() => checkout.mutate(code as "STARTER" | "GROWTH" | "PRO")} className="mt-3 rounded bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{checkout.isPending ? "Opening checkout…" : (data.status === "PAST_DUE" || data.status === "SUSPENDED" ? "Recover with " : "Choose ") + name}</button></div>)}</div>
    <div className="mt-6"><h3 className="font-medium text-ink">Billing history</h3>{history.data?.length ? <ul className="mt-2 space-y-2 text-sm">{history.data.map((invoice) => <li key={invoice.id} className="flex justify-between border-b border-line pb-2"><span>{new Date(invoice.occurredAt).toLocaleDateString()} · {invoice.status}</span><span>{formatCurrency(invoice.amount)} {invoice.currency}</span></li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">No commercial billing history yet.</p>}</div>
  </Card>;
}
