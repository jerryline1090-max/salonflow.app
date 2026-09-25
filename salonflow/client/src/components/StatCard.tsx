import type { ReactNode } from "react";
import { Card } from "@/components/Card";

interface StatCardProps {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning";
  hint?: string;
}

export function StatCard({ label, value, tone = "default", hint }: StatCardProps) {
  return (
    <Card className={`px-5 py-4 ${tone === "warning" ? "border-warning/40 bg-warning-bg/40" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1.5 font-display text-2xl ${tone === "warning" ? "text-warning" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}
