import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useBusiness } from "@/hooks/useAppData";
import { useUpdateBusinessSettings } from "@/hooks/useSettings";
import { ApiError } from "@/api/client";

export function SettingsReputation() {
  const { data: business } = useBusiness();
  const updateSettings = useUpdateBusinessSettings();
  const [form, setForm] = useState({
    reputationEnabled: true,
    reputationRequestDelayHours: "2",
    reputationHappyThreshold: "4",
    googleReviewUrl: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (business) {
      setForm({
        reputationEnabled: business.reputationEnabled,
        reputationRequestDelayHours: String(business.reputationRequestDelayHours),
        reputationHappyThreshold: String(business.reputationHappyThreshold),
        googleReviewUrl: business.googleReviewUrl ?? "",
      });
    }
  }, [business?.id]);

  async function handleSave() {
    setError(null);
    try {
      await updateSettings.mutateAsync({
        reputationEnabled: form.reputationEnabled,
        reputationRequestDelayHours: Number(form.reputationRequestDelayHours),
        reputationHappyThreshold: Number(form.reputationHappyThreshold),
        googleReviewUrl: form.googleReviewUrl || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save these changes.");
    }
  }

  return (
    <Card className="p-6">
      <p className="mb-1 font-display text-lg text-ink">Reputation</p>
      <p className="mb-4 text-sm text-ink-muted">
        A happy client gets offered this review link. An unhappy one is always routed to you privately first — never straight to a
        public review.
      </p>

      <label className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={form.reputationEnabled}
          onChange={(e) => setForm({ ...form, reputationEnabled: e.target.checked })}
        />
        Ask clients for feedback after a completed appointment
      </label>

      {form.reputationEnabled && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Ask for feedback after (hours)</label>
            <Input
              type="number"
              min={0}
              value={form.reputationRequestDelayHours}
              onChange={(e) => setForm({ ...form, reputationRequestDelayHours: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">"Happy" rating threshold (out of 5)</label>
            <Input
              type="number"
              min={1}
              max={5}
              value={form.reputationHappyThreshold}
              onChange={(e) => setForm({ ...form, reputationHappyThreshold: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Google review link</label>
            <Input
              value={form.googleReviewUrl}
              onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })}
              placeholder="https://g.page/r/your-salon/review"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={updateSettings.isPending} onClick={handleSave}>
          Save
        </Button>
      </div>
    </Card>
  );
}
