import { useMemo, useState, type FormEvent } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useServices } from "@/hooks/useAppData";
import { useCreateStaff } from "@/hooks/useStaffAdmin";
import { ApiError } from "@/api/client";

export function CreateStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: services } = useServices();
  const createStaff = useCreateStaff();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [homeServiceEligible, setHomeServiceEligible] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const skills = useMemo(
    () =>
      skillsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [skillsText]
  );

  function reset() {
    setName("");
    setPhone("");
    setSkillsText("");
    setHomeServiceEligible(false);
    setServiceIds([]);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createStaff.mutateAsync({
        name,
        phone: phone || undefined,
        skills,
        homeServiceEligible,
        serviceIds: serviceIds.length ? serviceIds : undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add this staff member.");
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="New staff member">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Phone</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Skills (comma-separated)</label>
          <Input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="braiding, coloring" />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={homeServiceEligible} onChange={(e) => setHomeServiceEligible(e.target.checked)} />
          Eligible for home-service appointments
        </label>

        {services && services.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Can perform</label>
            <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-1.5 rounded border border-line p-2">
              {services
                .filter((s) => s.isActive)
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-ink-soft">
                    <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                    {s.name}
                  </label>
                ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={createStaff.isPending}>
            Add staff member
          </Button>
        </div>
      </form>
    </Modal>
  );
}
