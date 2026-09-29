import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="font-display text-2xl text-ink sm:text-3xl">{title}</h1>{description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}</div>{actions && <div className="shrink-0">{actions}</div>}</header>;
}
