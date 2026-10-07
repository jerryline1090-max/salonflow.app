import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useBusiness } from "@/hooks/useAppData";
import { useSetWorkingHours } from "@/hooks/useSettings";
import { ApiError } from "@/api/client";
import type { BusinessHoursEntry } from "@/types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function defaultHours(existing?: BusinessHoursEntry[]): BusinessHoursEntry[] {
  return DAY_NAMES.map((_, dayOfWeek) => {
    const found = existing?.find((h) => h.dayOfWeek === dayOfWeek);
    return found
      ? { dayOfWeek, openTime: found.openTime, closeTime: found.closeTime, isClosed: found.isClosed }
      : { dayOfWeek, openTime: "09:00", closeTime: "18:00", isClosed: dayOfWeek === 0 };
  });
}

export function SettingsWorkingHours({ onSave }: { onSave?: (hours: BusinessHoursEntry[]) => Promise<unknown> }) {
  const { data: business } = useBusiness();
  const setWorkingHours = useSetWorkingHours();
  const [hours, setHours] = useState<BusinessHoursEntry[]>(defaultHours());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (business) setHours(defaultHours(business.workingHours));
  }, [business?.workingHours]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      if (onSave) await onSave(hours);
      else await setWorkingHours.mutateAsync(hours);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save working hours.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <p className="mb-1 font-display text-lg text-ink">Working hours</p>
      <p className="mb-4 text-sm text-ink-muted">
        The salon's own hours — the Calendar page and every booking channel's availability checks use this.
      </p>

      <div className="space-y-2">
        {hours.map((entry, i) => (
          <div key={entry.dayOfWeek} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-ink-soft">{DAY_NAMES[entry.dayOfWeek]}</span>
            <label className="flex items-center gap-1.5 text-ink-muted">
              <input
                type="checkbox"
                checked={!entry.isClosed}
                onChange={(e) => {
                  const next = [...hours];
                  next[i] = { ...entry, isClosed: !e.target.checked };
                  setHours(next);
                }}
              />
              Open
            </label>
            {!entry.isClosed && (
              <>
                <Input
                  type="time"
                  value={entry.openTime}
                  onChange={(e) => {
                    const next = [...hours];
                    next[i] = { ...entry, openTime: e.target.value };
                    setHours(next);
                  }}
                  className="w-28"
                />
                <span className="text-ink-muted">to</span>
                <Input
                  type="time"
                  value={entry.closeTime}
                  onChange={(e) => {
                    const next = [...hours];
                    next[i] = { ...entry, closeTime: e.target.value };
                    setHours(next);
                  }}
                  className="w-28"
                />
              </>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={saving || setWorkingHours.isPending} onClick={handleSave}>
          {onSave ? "Save hours and continue" : "Save working hours"}
        </Button>
      </div>
    </Card>
  );
}
