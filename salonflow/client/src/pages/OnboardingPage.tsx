import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { completeOnboardingAndRefresh, createOnboardingSubmitLock, onboardingServiceInput } from "@/onboardingWorkflow";
import { onboardingApi, settingsApi, teamApi } from "@/api/resources";
import { useBusiness } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { SettingsWorkingHours } from "@/components/settings/SettingsWorkingHours";
import { Card } from "@/components/Card";

const labels: Record<string, string> = { BUSINESS_DETAILS: "Business details", SERVICES: "Services", BUSINESS_HOURS: "Business hours", TEAM: "Team", INTEGRATIONS: "Integrations", REVIEW: "Review" };

export function OnboardingPage() {
  const { retryBootstrap } = useAuth();
  const businessQuery = useBusiness(); const { data: business } = businessQuery;
  const stateQuery = useQuery({ queryKey: ["onboarding", "state"], queryFn: onboardingApi.state, staleTime: 0, refetchOnMount: "always" });
  const state = stateQuery.data;
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = useRef(createOnboardingSubmitLock());
  const [service, setService] = useState({ name: "", price: "", durationMinutes: "60" }); const [team, setTeam] = useState({ name: "", email: "", password: "", role: "STAFF" as "STAFF" | "MANAGER" });
  const run = (task: () => Promise<unknown>, refreshStep = true) => submit.current(async () => {
    setSaving(true); setError("");
    try {
      await task();
      if (refreshStep) await Promise.all([businessQuery.refetch({ throwOnError: true }), stateQuery.refetch({ throwOnError: true })]);
    } catch (e) { setError(e instanceof Error ? e.message : "We couldn't save that. Please try again."); }
    finally { setSaving(false); }
  });
  if (stateQuery.isError || businessQuery.isError) return <div className="p-8"><p role="alert">We couldn't load your setup. Retry to load your saved progress.</p><Button className="mt-4" onClick={() => { void stateQuery.refetch(); void businessQuery.refetch(); }}>Retry</Button></div>;
  if (stateQuery.isFetching || !state || !business) return <div className="p-8 text-sm text-ink-muted">Loading setup…</div>;
  if (state.onboardingStatus === "COMPLETED") return <div className="p-8"><p>Setup is complete. Refresh your session to continue.</p><Button className="mt-4" loading={saving} onClick={() => run(retryBootstrap, false)}>Continue to SalonFlow</Button>{error && <p role="alert">{error}</p>}</div>;
  const step = state.onboardingStep ?? "BUSINESS_DETAILS"; const profile = { name: business.name, phone: business.phone ?? "", timezone: business.timezone ?? "Africa/Lagos" };
  const stepNumber = ["BUSINESS_DETAILS", "SERVICES", "BUSINESS_HOURS", "TEAM", "INTEGRATIONS", "REVIEW"].indexOf(step) + 1;
  return <div className="min-h-screen bg-workspace"><div className="mx-auto max-w-2xl p-4 sm:p-8"><p className="text-sm font-medium text-brass-600">Set up SalonFlow</p><h1 className="mt-1 font-display text-3xl text-ink">Let’s get your salon ready</h1><p className="mt-2 text-sm text-ink-muted">Step {stepNumber} of 6 · Your progress is saved as you go.</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper-sunken"><div className="h-full bg-brass-500 transition-[width]" style={{ width: `${(stepNumber / 6) * 100}%` }} /></div><Card className="mt-6 p-5 sm:p-7"><h2 className="font-display text-xl">{labels[step]}</h2>{error && <p className="mt-3 text-sm text-danger">{error}</p>}
    {step === "BUSINESS_DETAILS" && <StepForm initial={profile} saving={saving} onSubmit={(data: { name: string; phone: string; timezone: string }) => run(async () => { await settingsApi.update(data); await onboardingApi.advance(); })} />}
    {step === "SERVICES" && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); run(async () => { await onboardingApi.createService(onboardingServiceInput(service)); await onboardingApi.advance(); }); }}><p className="text-sm text-ink-muted">Add one active service to start taking bookings.</p><Input required placeholder="Service name" value={service.name} onChange={e => setService({ ...service, name: e.target.value })}/><label htmlFor="onboarding-price" className="block text-sm">Price (₦)</label><Input id="onboarding-price" required min="0" step="0.01" type="number" placeholder="Price in naira" value={service.price} onChange={e => setService({ ...service, price: e.target.value })}/><Input required min="1" type="number" value={service.durationMinutes} onChange={e => setService({ ...service, durationMinutes: e.target.value })}/><Button loading={saving}>Save service and continue</Button></form>}
    {step === "BUSINESS_HOURS" && <SettingsWorkingHours onSave={(hours) => run(() => onboardingApi.saveBusinessHours(hours))} />}
    {step === "TEAM" && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); run(async () => { await teamApi.invite(team); await onboardingApi.advance(); }); }}><p className="text-sm text-ink-muted">Optional login accounts; these are not bookable Staff profiles.</p><Input required placeholder="Name" value={team.name} onChange={e => setTeam({ ...team, name: e.target.value })}/><Input required type="email" placeholder="Email" value={team.email} onChange={e => setTeam({ ...team, email: e.target.value })}/><Input required type="password" placeholder="Temporary password" value={team.password} onChange={e => setTeam({ ...team, password: e.target.value })}/><Button type="button" variant="secondary" onClick={() => run(onboardingApi.skip)}>Skip for now</Button><Button className="ml-2" loading={saving}>Add team account</Button></form>}
    {step === "INTEGRATIONS" && <StepNotice text="WhatsApp and Instagram can be connected later from Settings. They are optional." saving={saving} onClick={() => run(onboardingApi.skip)} />}
    {step === "REVIEW" && <Review saving={saving} onComplete={() => run(() => completeOnboardingAndRefresh(onboardingApi.complete, retryBootstrap), false)}/>}</Card></div></div>;
}
function StepForm({ initial, saving, onSubmit }: any) { const [data, setData] = useState(initial); return <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); onSubmit(data); }}><Input required value={data.name} onChange={e => setData({ ...data, name: e.target.value })}/><Input required value={data.phone} onChange={e => setData({ ...data, phone: e.target.value })}/><Input required value={data.timezone} onChange={e => setData({ ...data, timezone: e.target.value })}/><Button loading={saving}>Continue</Button></form>; }
function StepNotice({ text, saving, onClick }: any) { return <div className="mt-4"><p className="text-sm text-ink-muted">{text}</p><Button className="mt-4" loading={saving} onClick={onClick}>Continue</Button></div>; }
function Review({ saving, onComplete }: { saving: boolean; onComplete: () => Promise<void> }) {
  const query = useQuery({ queryKey: ["onboarding", "review"], queryFn: onboardingApi.review, staleTime: 0, refetchOnMount: "always" });
  if (query.isError) return <div className="mt-4"><p role="alert">We couldn't load your setup review.</p><Button onClick={() => { void query.refetch(); }}>Retry</Button></div>;
  if (query.isFetching || !query.data) return <p className="mt-4 text-sm text-ink-muted">Loading review…</p>;
  const review = query.data;
  return <div className="mt-4 space-y-3 text-sm"><p>{review.business.name} · {review.business.timezone}</p><p>{review.activeServiceCount} active service(s), {review.teamAccountCount} team account(s)</p><Button loading={saving} onClick={onComplete}>Finish setup</Button></div>;
}
