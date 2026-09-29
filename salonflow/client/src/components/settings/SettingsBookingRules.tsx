import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useBusiness } from "@/hooks/useAppData";
import { useUpdateBusinessSettings } from "@/hooks/useSettings";
import { ApiError } from "@/api/client";

export function SettingsBookingRules() {
  const { data: business } = useBusiness();
  const updateSettings = useUpdateBusinessSettings();
  const [form, setForm] = useState({
    defaultBufferMinutes: "0",
    minBookingNoticeMins: "0",
    maxBookingHorizonDays: "60",
    homeServiceTravelBufferMins: "0",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (business) {
      setForm({
        defaultBufferMinutes: String(business.defaultBufferMinutes),
        minBookingNoticeMins: String(business.minBookingNoticeMins),
        maxBookingHorizonDays: String(business.maxBookingHorizonDays),
        homeServiceTravelBufferMins: String(business.homeServiceTravelBufferMins),
      });
    }
  }, [business?.id]);

  async function handleSave() {
    setError(null);
    try {
      await updateSettings.mutateAsync({
        defaultBufferMinutes: Number(form.defaultBufferMinutes),
        minBookingNoticeMins: Number(form.minBookingNoticeMins),
        maxBookingHorizonDays: Number(form.maxBookingHorizonDays),
        homeServiceTravelBufferMins: Number(form.homeServiceTravelBufferMins),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save these changes.");
    }
  }

  return (
    <Card className="p-6">
      <p className="mb-1 font-display text-lg text-ink">Booking rules</p>
      <p className="mb-4 text-sm text-ink-muted">Business-wide defaults — a service's own buffer/duration always takes precedence.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Default buffer between appointments (min)</label>
          <Input
            type="number"
            min={0}
            value={form.defaultBufferMinutes}
            onChange={(e) => setForm({ ...form, defaultBufferMinutes: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Minimum booking notice (min)</label>
          <Input
            type="number"
            min={0}
            value={form.minBookingNoticeMins}
            onChange={(e) => setForm({ ...form, minBookingNoticeMins: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">How far ahead clients can book (days)</label>
          <Input
            type="number"
            min={1}
            value={form.maxBookingHorizonDays}
            onChange={(e) => setForm({ ...form, maxBookingHorizonDays: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Home-service travel buffer (min)</label>
          <Input
            type="number"
            min={0}
            value={form.homeServiceTravelBufferMins}
            onChange={(e) => setForm({ ...form, homeServiceTravelBufferMins: e.target.value })}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={updateSettings.isPending} onClick={handleSave}>
          Save booking rules
        </Button>
      </div>
    </Card>
  );
}
