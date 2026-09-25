import { useEffect, useState, type FormEvent } from "react";
import type { Appointment } from "@/types";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useRescheduleAppointment } from "@/hooks/useAppointments";
import { ApiError } from "@/api/client";
import { toDatetimeLocalValue } from "@/utils/format";

export function RescheduleModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const reschedule = useRescheduleAppointment();
  const [newStartsAt, setNewStartsAt] = useState(appointment ? toDatetimeLocalValue(appointment.startsAt) : "");

  // This component stays mounted across different appointments (the parent
  // renders it unconditionally and just swaps the `appointment` prop), so
  // useState's initial value alone isn't enough — without this, reopening
  // for a second, different appointment would show the first one's stale time.
  useEffect(() => {
    if (appointment) setNewStartsAt(toDatetimeLocalValue(appointment.startsAt));
  }, [appointment?.id]);
  const [error, setError] = useState<string | null>(null);

  if (!appointment) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await reschedule.mutateAsync({ id: appointment!.id, newStartsAt: new Date(newStartsAt).toISOString() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reschedule this appointment.");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reschedule ${appointment.client?.name ?? "appointment"}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-starts-at" className="block text-sm font-medium text-ink-soft mb-1.5">
            New date &amp; time
          </label>
          <Input
            id="new-starts-at"
            type="datetime-local"
            required
            value={newStartsAt}
            onChange={(e) => setNewStartsAt(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={reschedule.isPending}>
            Confirm new time
          </Button>
        </div>
      </form>
    </Modal>
  );
}
