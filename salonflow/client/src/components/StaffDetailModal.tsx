import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useServices } from "@/hooks/useAppData";
import { useStaffMember, useUpdateStaff, useSetStaffSchedule, useSetStaffServices, useSetStaffStatus } from "@/hooks/useStaffAdmin";
import { ApiError } from "@/api/client";
import { formatDateTime } from "@/utils/format";
import type { StaffScheduleEntry } from "@/types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function defaultSchedule(existing?: StaffScheduleEntry[]): StaffScheduleEntry[] {
  return DAY_NAMES.map((_, dayOfWeek) => {
    const found = existing?.find((s) => s.dayOfWeek === dayOfWeek);
    return found ?? { dayOfWeek, startTime: "09:00", endTime: "18:00", isOff: dayOfWeek === 0 };
  });
}

interface AffectedWarning {
  staffName: string;
  appointments: { id: string; startsAt: string; clientName: string }[];
}

export function StaffDetailModal({ staffId, onClose }: { staffId: string | null; onClose: () => void }) {
  const { data: staff } = useStaffMember(staffId);
  const { data: services } = useServices();
  const updateStaff = useUpdateStaff();
  const setSchedule = useSetStaffSchedule();
  const setServices = useSetStaffServices();
  const setStatus = useSetStaffStatus();

  const [profile, setProfile] = useState({ name: "", phone: "", homeServiceEligible: false });
  const [schedule, setScheduleState] = useState<StaffScheduleEntry[]>(defaultSchedule());
  const [serviceIds, setServiceIdsState] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [affectedWarning, setAffectedWarning] = useState<AffectedWarning | null>(null);

  useEffect(() => {
    if (staff) {
      setProfile({ name: staff.name, phone: staff.phone ?? "", homeServiceEligible: staff.homeServiceEligible });
      setScheduleState(defaultSchedule(staff.schedule));
      setServiceIdsState(staff.services?.map((link) => link.serviceId) ?? []);
    }
  }, [staff?.id]);

  if (!staffId || !staff) return null;

  async function handleSaveProfile() {
    setError(null);
    try {
      await updateStaff.mutateAsync({ id: staffId!, updates: profile });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this staff member's profile.");
    }
  }

  async function handleSaveSchedule() {
    setError(null);
    try {
      await setSchedule.mutateAsync({ id: staffId!, schedule });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this schedule.");
    }
  }

  function toggleService(id: string) {
    setServiceIdsState((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSaveServices() {
    setError(null);
    try {
      await setServices.mutateAsync({ id: staffId!, serviceIds });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save which services this staff member performs.");
    }
  }

  async function handleStatusChange(newStatus: "ACTIVE" | "INACTIVE" | "REMOVED") {
    setError(null);
    setAffectedWarning(null);
    try {
      const result = await setStatus.mutateAsync({ id: staffId!, newStatus });
      if (result.affectedAppointments.length > 0) {
        setAffectedWarning({
          staffName: staff!.name,
          appointments: result.affectedAppointments.map((a) => ({
            id: a.id,
            startsAt: a.startsAt,
            clientName: a.client?.name ?? "a client",
          })),
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this staff member's status.");
    }
  }

  return (
    <Modal open onClose={onClose} title={staff.name} size="lg">
      <div className="space-y-6">
        {error && (
          <p className="text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
            {error}
          </p>
        )}

        {affectedWarning && (
          <div className="rounded border border-warning/40 bg-warning-bg px-4 py-3">
            <p className="text-sm font-medium text-warning">
              {affectedWarning.staffName} has {affectedWarning.appointments.length} upcoming appointment
              {affectedWarning.appointments.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {affectedWarning.appointments.map((a) => (
                <li key={a.id}>
                  {a.clientName} — {formatDateTime(a.startsAt)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">Reassign these from the Appointments page — nothing here does that automatically.</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Status</p>
          <div className="flex gap-2">
            {(["ACTIVE", "INACTIVE", "REMOVED"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={staff.status === s ? "primary" : "secondary"}
                loading={setStatus.isPending}
                onClick={() => handleStatusChange(s)}
              >
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </Button>
            ))}
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <p className="mb-3 text-sm font-medium text-ink">Profile</p>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            <Input placeholder="Phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={profile.homeServiceEligible}
              onChange={(e) => setProfile({ ...profile, homeServiceEligible: e.target.checked })}
            />
            Eligible for home-service appointments
          </label>
          <div className="mt-3 flex justify-end">
            <Button size="sm" loading={updateStaff.isPending} onClick={handleSaveProfile}>
              Save profile
            </Button>
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <p className="mb-3 text-sm font-medium text-ink">Weekly schedule</p>
          <div className="space-y-2">
            {schedule.map((entry, i) => (
              <div key={entry.dayOfWeek} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-ink-soft">{DAY_NAMES[entry.dayOfWeek]}</span>
                <label className="flex items-center gap-1.5 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={!entry.isOff}
                    onChange={(e) => {
                      const next = [...schedule];
                      next[i] = { ...entry, isOff: !e.target.checked };
                      setScheduleState(next);
                    }}
                  />
                  Working
                </label>
                {!entry.isOff && (
                  <>
                    <Input
                      type="time"
                      value={entry.startTime}
                      onChange={(e) => {
                        const next = [...schedule];
                        next[i] = { ...entry, startTime: e.target.value };
                        setScheduleState(next);
                      }}
                      className="w-28"
                    />
                    <span className="text-ink-muted">to</span>
                    <Input
                      type="time"
                      value={entry.endTime}
                      onChange={(e) => {
                        const next = [...schedule];
                        next[i] = { ...entry, endTime: e.target.value };
                        setScheduleState(next);
                      }}
                      className="w-28"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" loading={setSchedule.isPending} onClick={handleSaveSchedule}>
              Save schedule
            </Button>
          </div>
        </div>

        {services && services.length > 0 && (
          <div className="border-t border-line pt-4">
            <p className="mb-3 text-sm font-medium text-ink">Can perform</p>
            <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-1.5 rounded border border-line p-2">
              {services
                .filter((s) => s.isActive)
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-ink-soft">
                    <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                    {s.name}
                  </label>
                ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" loading={setServices.isPending} onClick={handleSaveServices}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
