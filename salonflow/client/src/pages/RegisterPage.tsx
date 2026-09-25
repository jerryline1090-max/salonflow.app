import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/api/client";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ ownerName: "", email: "", password: "", confirmPassword: "", businessName: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const update = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: event.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirmPassword) return setError("Passwords do not match.");
    setError(null); setSubmitting(true);
    try {
      await register({ businessName: form.businessName, ownerName: form.ownerName, email: form.email, password: form.password, phone: form.phone });
      navigate("/onboarding", { replace: true });
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Couldn't create your account. Please try again.");
    } finally { setSubmitting(false); }
  }

  return <div className="flex min-h-screen items-center justify-center px-4 py-8"><div className="w-full max-w-lg">
    <div className="mb-8 text-center"><p className="font-display text-3xl text-ink">SalonFlow</p><p className="mt-1 text-sm text-ink-muted">Set up your salon workspace</p></div>
    <form onSubmit={submit} className="grid gap-4 rounded-lg border border-line bg-paper-raised p-5 shadow-card sm:grid-cols-2 sm:p-7">
      <Field label="Full name"><Input required autoComplete="name" value={form.ownerName} onChange={update("ownerName")} /></Field>
      <Field label="Salon/business name"><Input required value={form.businessName} onChange={update("businessName")} /></Field>
      <Field label="Email"><Input required type="email" autoComplete="email" value={form.email} onChange={update("email")} /></Field>
      <Field label="Phone"><Input required type="tel" autoComplete="tel" value={form.phone} onChange={update("phone")} /></Field>
      <Field label="Password"><Input required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={update("password")} /></Field>
      <Field label="Confirm password"><Input required minLength={8} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={update("confirmPassword")} /></Field>
      {error && <p role="alert" className="sm:col-span-2 rounded bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" loading={submitting} className="sm:col-span-2">Create your SalonFlow account</Button>
      <p className="sm:col-span-2 text-center text-sm text-ink-muted">Already have an account? <Link to="/login" className="text-brass-600 underline">Sign in</Link></p>
    </form>
  </div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm font-medium text-ink-soft"><span className="mb-1.5 block">{label}</span>{children}</label>; }
