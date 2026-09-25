import { useState, type FormEvent } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useClient, useClientStats, useUpdateClient } from "@/hooks/useAppData";
import { useAppointments } from "@/hooks/useAppointments";
import { formatCurrency, formatDate, formatDateTime } from "@/utils/format";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";

export function ClientDetailModal({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const { data: client, isLoading } = useClient(clientId);
  const { data: stats } = useClientStats(clientId);
  const { data: appointments } = useAppointments(clientId ? { clientId } : undefined);
  const updateClient = useUpdateClient();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  const canEdit = user?.role === "OWNER" || user?.role === "MANAGER";

  function startEditing() {
    if (!client) return;
    setForm({
      name: client.name,
      phone: client.phone ?? "",
      email: client.email ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
    });
    setEditing(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateClient.mutateAsync({ id: clientId!, updates: form });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save these changes.");
    }
  }

  if (!clientId) return null;

  return (
    <Modal open onClose={onClose} title="Client details" size="lg">
      {isLoading || !client ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-ink-muted" />
        </div>
      ) : editing ? (
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-soft mb-1.5">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-soft mb-1.5">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Address</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:border-brass-500"
            />
          </div>
          {error && (
            <p className="text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={updateClient.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-display text-xl text-ink">{client.name}</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {[client.phone, client.email].filter(Boolean).join(" · ") || "No contact info on file"}
              </p>
            </div>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={startEditing}>
                Edit
              </Button>
            )}
          </div>

          {client.address && (
            <p className="text-sm text-ink-soft">
              <span className="text-ink-muted">Address:</span> {client.address}
            </p>
          )}
          {client.notes && (
            <p className="text-sm text-ink-soft">
              <span className="text-ink-muted">Notes:</span> {client.notes}
            </p>
          )}

          <div className="grid grid-cols-4 gap-3">
            <StatBlock label="Visits" value={stats?.totalVisits ?? "—"} />
            <StatBlock label="Upcoming" value={stats?.upcomingCount ?? "—"} />
            <StatBlock label="No-shows" value={stats?.noShowCount ?? "—"} />
            <StatBlock label="Total spent" value={stats ? formatCurrency(stats.totalSpent) : "—"} />
          </div>
          {stats?.lastVisitAt && <p className="text-xs text-ink-muted">Last visit: {formatDate(stats.lastVisitAt)}</p>}

          <div className="border-t border-line pt-4">
            <p className="mb-3 text-sm font-medium text-ink">Appointment history</p>
            {!appointments || appointments.length === 0 ? (
              <p className="text-sm text-ink-muted">No appointments on file yet.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                {appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="text-ink">{a.service?.name}</p>
                      <p className="text-xs text-ink-muted">{formatDateTime(a.startsAt)}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-line bg-paper-sunken px-3 py-2.5 text-center">
      <p className="font-display text-lg text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
