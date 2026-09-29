import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useService, useUpdateService, useDeactivateService } from "@/hooks/useServices";
import { ApiError } from "@/api/client";
import { koboToNaira, nairaToKobo } from "@/utils/format";

export function ServiceDetailModal({ serviceId, onClose }: { serviceId: string | null; onClose: () => void }) {
  const { data: service } = useService(serviceId);
  const updateService = useUpdateService();
  const deactivateService = useDeactivateService();

  const [form, setForm] = useState({
    name: "",
    category: "",
    price: "",
    durationMinutes: "",
    availableAtSalon: true,
    availableAtHome: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  useEffect(() => {
    if (service) {
      setForm({
        name: service.name,
        category: service.category ?? "",
        price: String(koboToNaira(service.price)),
        durationMinutes: String(service.durationMinutes),
        availableAtSalon: service.availableAtSalon,
        availableAtHome: service.availableAtHome,
      });
    }
  }, [service?.id]);

  if (!serviceId || !service) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.availableAtSalon && !form.availableAtHome) {
      setError("A service must be available at the salon, at home, or both.");
      return;
    }

    try {
      await updateService.mutateAsync({
        id: serviceId!,
        updates: {
          name: form.name,
          category: form.category || undefined,
          price: nairaToKobo(Number(form.price)),
          durationMinutes: Number(form.durationMinutes),
          availableAtSalon: form.availableAtSalon,
          availableAtHome: form.availableAtHome,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save these changes.");
    }
  }

  async function handleDeactivate() {
    try {
      await deactivateService.mutateAsync(serviceId!);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't deactivate this service.");
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit service">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!service.isActive && (
          <p className="text-sm text-ink-muted bg-paper-sunken rounded-sm px-3 py-2">
            This service is deactivated and won't appear when booking new appointments. Past appointments that used it are unaffected.
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Category</label>
          <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Price (₦)</label>
            <Input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Duration (minutes)</label>
            <Input
              type="number"
              min={1}
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Available</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.availableAtSalon}
                onChange={(e) => setForm({ ...form, availableAtSalon: e.target.checked })}
              />
              At the salon
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.availableAtHome}
                onChange={(e) => setForm({ ...form, availableAtHome: e.target.checked })}
              />
              As a home visit
            </label>
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-line pt-4">
          {service.isActive ? (
            confirmingDeactivate ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">Deactivate this service?</span>
                <Button type="button" size="sm" variant="danger" loading={deactivateService.isPending} onClick={handleDeactivate}>
                  Yes, deactivate
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingDeactivate(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingDeactivate(true)}>
                Deactivate
              </Button>
            )
          ) : (
            <span />
          )}

          <Button type="submit" loading={updateService.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
