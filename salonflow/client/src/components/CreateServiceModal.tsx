import { useState, type FormEvent } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useCreateService } from "@/hooks/useServices";
import { ApiError } from "@/api/client";
import { nairaToKobo } from "@/utils/format";

export function CreateServiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createService = useCreateService();
  const [form, setForm] = useState({
    name: "",
    category: "",
    price: "",
    durationMinutes: "",
    availableAtSalon: true,
    availableAtHome: false,
  });
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setForm({ name: "", category: "", price: "", durationMinutes: "", availableAtSalon: true, availableAtHome: false });
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.availableAtSalon && !form.availableAtHome) {
      setError("A service must be available at the salon, at home, or both.");
      return;
    }

    try {
      await createService.mutateAsync({
        name: form.name,
        category: form.category || undefined,
        price: nairaToKobo(Number(form.price)),
        durationMinutes: Number(form.durationMinutes),
        availableAtSalon: form.availableAtSalon,
        availableAtHome: form.availableAtHome,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create this service.");
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="New service">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Knotless Braids" />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Category (optional)</label>
          <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Braids" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Price (₦)</label>
            <Input
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
              placeholder="40000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Duration (minutes)</label>
            <Input
              type="number"
              min={1}
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              required
              placeholder="180"
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

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={createService.isPending}>
            Add service
          </Button>
        </div>
      </form>
    </Modal>
  );
}
