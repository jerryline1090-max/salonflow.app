import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { referralsApi } from "@/api/resources";
import { Alert } from "@/components/Alert";
import { Card } from "@/components/Card";
import { formatCurrency } from "@/utils/format";

export function SettingsReferrals() {
  const { user } = useAuth();
  const referrals = useQuery({ queryKey: ["referrals"], queryFn: referralsApi.get, enabled: user?.role === "OWNER" });
  if (user?.role !== "OWNER") return null;
  if (referrals.isError) return <Alert tone="error">Referral details could not be loaded.</Alert>;
  if (!referrals.data) return null;
  const { referralCode, referralLink, counts, creditBalance, credits } = referrals.data;
  const shareLink = `${window.location.origin}${referralLink}`;
  return <Card className="p-5">
    <h2 className="font-display text-xl text-ink">Refer &amp; earn</h2>
    <p className="mt-1 text-sm text-ink-muted">Share your code with another salon. A billing credit is earned only after their first verified subscription payment. Your balance is recorded in SalonFlow; automatic payment application is not available yet.</p>
    <div className="mt-4 rounded border border-line bg-workspace p-3"><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Your referral code</p><p className="mt-1 font-mono text-lg font-semibold text-ink">{referralCode}</p><p className="mt-2 break-all text-xs text-ink-muted">{shareLink}</p></div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-ink-muted">Attributed</dt><dd className="mt-1 font-medium text-ink">{counts.attributed}</dd></div><div><dt className="text-ink-muted">Rewarded</dt><dd className="mt-1 font-medium text-ink">{counts.rewarded}</dd></div><div><dt className="text-ink-muted">Credit balance</dt><dd className="mt-1 font-medium text-ink">{formatCurrency(creditBalance)}</dd></div></dl>
    <div className="mt-5"><h3 className="font-medium text-ink">Credit history</h3>{credits.length ? <ul className="mt-2 space-y-2 text-sm">{credits.map((credit) => <li key={credit.id} className="flex justify-between border-b border-line pb-2"><span>{new Date(credit.createdAt).toLocaleDateString()} · {credit.reason.replace(/_/g, " ")}</span><span className={credit.direction === "CREDIT" ? "text-emerald-700" : "text-ink"}>{credit.direction === "CREDIT" ? "+" : "−"}{formatCurrency(credit.amount)}</span></li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">No referral credits yet.</p>}</div>
  </Card>;
}
