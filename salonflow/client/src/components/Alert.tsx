import type { HTMLAttributes, ReactNode } from "react";

const tones = { error: "border-danger/25 bg-danger-bg text-danger", warning: "border-warning/25 bg-warning-bg text-warning", success: "border-success/25 bg-success-bg text-success", info: "border-info/25 bg-info-bg text-info" };
export function Alert({ tone = "info", children, className = "", ...props }: HTMLAttributes<HTMLParagraphElement> & { tone?: keyof typeof tones; children: ReactNode }) {
  return <p role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${tones[tone]} ${className}`} {...props}>{children}</p>;
}
