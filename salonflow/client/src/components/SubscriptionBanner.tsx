import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export function SubscriptionBanner() {
  const { user } = useAuth();
  const subscription = user?.subscription;
  if (!subscription || !subscription.warning) return null;
  const isGrace = subscription.warning === "GRACE_PERIOD";
  const ownerCopy = isGrace
    ? "Your salon is in a grace period. Restore billing to avoid restricted access."
    : "Payment for your salon subscription needs attention.";
  return (
    <div className="border-b border-warning/30 bg-warning-bg px-4 py-2 text-sm text-warning">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <span>{ownerCopy}</span>
        {user?.role === "OWNER" && <Link to="/settings/billing" className="shrink-0 font-medium underline underline-offset-2">Review billing</Link>}
      </div>
    </div>
  );
}
