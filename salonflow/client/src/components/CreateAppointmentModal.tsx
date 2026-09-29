import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { useClients, useCreateClient, useServices, useStaff } from "@/hooks/useAppData";
import { useCreateAppointment } from "@/hooks/useAppointments";
import { ApiError } from "@/api/client";
import type { LocationType } from "@/types";
import { formatCurrency, formatDuration } from "@/utils/format";

interface CreateAppointmentModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fills staff/time — used by the Calendar page's click-an-open-slot flow. */
  prefill?: { staffId?: string; startsAt?: string };
}

export function CreateAppointmentModal({ open, onClose, prefill }: CreateAppointmentModalProps) {
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [selectedClientName, setSelectedClientName] = useState("");
  const { data: clients } = useClients(1, 20, debouncedClientSearch);
  const { data: services } = useServices();
  const { data: staff } = useStaff(1, 100);
  const createClient = useCreateClient();
  const createAppointment = useCreateAppointment();

  const [isNewClient, setIsNewClient] = useState(false);
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [locationType, setLocationType] = useState<LocationType>("SALON");
  const [homeAddress, setHomeAddress] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedClientSearch(clientSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [clientSearch]);

  useEffect(() => {
    if (open && prefill) {
      if (prefill.staffId) setStaffId(prefill.staffId);
      if (prefill.startsAt) setStartsAt(prefill.startsAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.staffId, prefill?.startsAt]);

  const selectedService = useMemo(() => services?.find((s) => s.id === serviceId), [services, serviceId]);
  const clientItems = clients?.items ?? [];
  const staffItems = staff?.items ?? [];

  const qualifiedStaff = useMemo(() => {
    if (!serviceId) return staffItems;
    return staffItems.filter((s) => s.services?.some((link) => link.serviceId === serviceId));
  }, [staffItems, serviceId]);

  function resetForm() {
    setIsNewClient(false);
    setClientId("");
    setClientSearch("");
    setSelectedClientName("");
    setNewClientName("");
    setNewClientPhone("");
    setServiceId("");
    setStaffId("");
    setLocationType("SALON");
    setHomeAddress("");
    setStartsAt("");
    setNotes("");
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      let resolvedClientId = clientId;
      if (isNewClient) {
        if (!newClientName.trim()) {
          setError("Enter the new client's name.");
          return;
        }
        const created = await createClient.mutateAsync({ name: newClientName, phone: newClientPhone || undefined });
        resolvedClientId = created.id;
      }

      if (!resolvedClientId || !serviceId || !staffId || !startsAt) {
        setError("Fill in every field before booking.");
        return;
      }

      await createAppointment.mutateAsync({
        clientId: resolvedClientId,
        serviceId,
        staffId,
        startsAt: new Date(startsAt).toISOString(),
        locationType,
        homeAddress: locationType === "HOME" ? homeAddress : undefined,
        notes: notes || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't book this appointment.");
    }
  }

  const submitting = createAppointment.isPending || createClient.isPending;

  return (
    <Modal open={open} onClose={handleClose} title="New appointment" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-sm font-medium text-ink-soft">Client</label>
            <button
              type="button"
              onClick={() => setIsNewClient((v) => !v)}
              className="text-xs text-brass-600 hover:underline underline-offset-2"
            >
              {isNewClient ? "Choose an existing client instead" : "New client"}
            </button>
          </div>
          {isNewClient ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input placeholder="Full name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} required />
              <Input placeholder="Phone (optional)" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-2">
              <Input value={clientSearch} onChange={(e) => { setClientSearch(e.target.value); setClientId(""); setSelectedClientName(""); }} placeholder="Search name, phone, or email…" aria-label="Search existing clients" />
              {clientId ? <p className="text-sm text-ink-soft">Selected: <span className="font-medium text-ink">{selectedClientName}</span></p> : <div className="max-h-36 overflow-y-auto rounded border border-line bg-paper-raised">{clientItems.length === 0 ? <p className="px-3 py-2 text-sm text-ink-muted">No matching clients.</p> : clientItems.map((client) => <button key={client.id} type="button" onClick={() => { setClientId(client.id); setSelectedClientName(client.name); setClientSearch(client.name); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-paper-sunken"><span className="font-medium text-ink">{client.name}</span>{client.phone && <span className="ml-2 text-ink-muted">{client.phone}</span>}</button>)}</div>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Service</label>
            <Select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setStaffId("");
              }}
              required
            >
              <option value="">Select a service…</option>
              {services
                ?.filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {formatCurrency(s.price)} · {formatDuration(s.durationMinutes)}
                  </option>
                ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Staff</label>
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} required disabled={!serviceId}>
              <option value="">{serviceId ? "Select a staff member…" : "Choose a service first"}</option>
              {qualifiedStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {serviceId && qualifiedStaff.length === 0 && (
              <p className="mt-1 text-xs text-warning">No staff are currently linked to this service.</p>
            )}
          </div>
        </div>

        {selectedService?.availableAtHome && selectedService?.availableAtSalon && (
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Location</label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={locationType === "SALON" ? "primary" : "secondary"}
                onClick={() => setLocationType("SALON")}
              >
                At the salon
              </Button>
              <Button
                type="button"
                size="sm"
                variant={locationType === "HOME" ? "primary" : "secondary"}
                onClick={() => setLocationType("HOME")}
              >
                Home visit
              </Button>
            </div>
          </div>
        )}

        {locationType === "HOME" && (
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Client's address</label>
            <Input value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} required placeholder="Street, area, city" />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Date &amp; time</label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-soft mb-1.5">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brass-500"
            placeholder="Anything the staff member should know"
          />
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
          <Button type="submit" loading={submitting}>
            Book appointment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
