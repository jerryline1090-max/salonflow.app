import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { useBusiness } from "@/hooks/useAppData";
import { useUpdateBusinessSettings } from "@/hooks/useSettings";
import { ApiError } from "@/api/client";

export function SettingsBusinessProfile() {
  const { data: business } = useBusiness();
  const updateSettings = useUpdateBusinessSettings();
  const [form, setForm] = useState({ name: "", description: "", phone: "", email: "", address: "", mode: "SALON_ONLY" as const });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (business) {
      setForm({
        name: business.name,
        description: business.description ?? "",
        phone: business.phone ?? "",
        email: business.email ?? "",
        address: business.address ?? "",
        mode: business.mode as any,
      });
    }
  }, [business?.id]);

  async function handleSave() {
    setError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync(form);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save these changes.");
    }
  }

  return (
    <Card className="p-6">
      <p className="mb-1 font-display text-lg text-ink">Business profile</p>
      <p className="mb-4 text-sm text-ink-muted">
        This is what shows up throughout the workspace — your team sees your salon's own name, not a generic app.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Business name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Description</label>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Phone</label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Email</label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Address</label>
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Business model</label>
          <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as any })}>
            <option value="SALON_ONLY">Salon only</option>
            <option value="HOME_ONLY">Home service only</option>
            <option value="BOTH">Both salon and home service</option>
          </Select>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}
      {saved && !error && <p className="mt-4 text-sm text-success">Saved.</p>}

      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={updateSettings.isPending} onClick={handleSave}>
          Save profile
        </Button>
      </div>
    </Card>
  );
}
