import { useState, type FormEvent } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useCreateClient } from "@/hooks/useAppData";
import { ApiError } from "@/api/client";

export function CreateClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createClient = useCreateClient();
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setForm({ name: "", phone: "", email: "", address: "" });
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createClient.mutateAsync({
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add this client.");
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="New client">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Phone</label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Email</label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Address</label>
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
          <Button type="submit" loading={createClient.isPending}>
            Add client
          </Button>
        </div>
      </form>
    </Modal>
  );
}
