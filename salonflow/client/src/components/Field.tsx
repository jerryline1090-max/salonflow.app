import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "./Input";

export function Field({ label, hint, error, inputProps }: { label: string; hint?: string; error?: string; inputProps: InputHTMLAttributes<HTMLInputElement> }) {
  const id = useId(); const hintId = `${id}-hint`; const errorId = `${id}-error`;
  return <label className="block text-sm font-medium text-ink-soft" htmlFor={id}><span className="mb-1.5 block">{label}</span><Input id={id} aria-describedby={error ? errorId : hint ? hintId : undefined} aria-invalid={Boolean(error)} {...inputProps} />{hint && !error && <span id={hintId} className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span>}{error && <span id={errorId} className="mt-1 block text-xs font-normal text-danger">{error}</span>}</label>;
}
export function FieldGroup({ children }: { children: ReactNode }) { return <div className="grid gap-4 sm:grid-cols-2">{children}</div>; }
