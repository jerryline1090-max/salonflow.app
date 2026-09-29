import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { SettingsBilling } from "@/components/settings/SettingsBilling";
import { Button } from "@/components/Button";

export function SubscriptionRecoveryPage() {
  const { user, logout } = useAuth();
  const owner = user?.role === "OWNER";
  return <div className="min-h-screen bg-workspace px-4 py-10"><div className="mx-auto max-w-2xl"><p className="font-display text-2xl text-ink">SalonFlow</p><div className="mt-6 rounded-lg border border-line bg-surface p-6 shadow-card"><h1 className="font-display text-2xl text-ink">Business access needs attention</h1><p className="mt-2 text-sm text-ink-muted">{owner ? "Your subscription needs recovery before operational salon tools can be used." : "Your salon’s subscription needs owner action before operational tools can be used."}</p>{owner ? <div className="mt-6"><SettingsBilling /></div> : <p className="mt-5 text-sm text-ink-soft">Please contact your salon owner. Billing details are only available to the owner.</p>}<div className="mt-6 flex gap-3">{owner && <Link to="/settings/billing"><Button>Billing</Button></Link>}<Button variant="secondary" onClick={logout}>Sign out</Button></div></div></div></div>;
}
