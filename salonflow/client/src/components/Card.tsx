import type { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-paper-raised border border-line rounded-lg shadow-card ${className}`} {...rest} />;
}
