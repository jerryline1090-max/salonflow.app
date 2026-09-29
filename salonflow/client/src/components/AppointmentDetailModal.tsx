import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import { Input } from "@/components/Input";
import { StatusBadge } from "@/components/StatusBadge";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/auth/AuthContext";
import { useAppointment, useChangeAppointmentStatus, useReassignAppointment } from "@/hooks/useAppointments";
import { useStaff } from "@/hooks/useAppData";
import { useOutstandingBalance, useRecordPayment } from "@/hooks/usePayments";
import { allowedNextStatuses, STATUS_LABELS } from "@/utils/appointmentTransitions";
import { formatCurrency, formatDateTime, formatDuration, koboToNaira, nairaToKobo } from "@/utils/format";
import { ApiError } from "@/api/client";
import type { AppointmentStatus, PaymentMethod } from "@/types";

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Created",
  STATUS_CHANGED: "Status changed",
  TIME_CHANGED: "Time changed",
  DATE_CHANGED: "Date changed",
  SERVICE_CHANGED: "Service changed",
  STAFF_CHANGED: "Staff changed",
  CLIENT_CHANGED: "Client changed",
  PAYMENT_ADDED: "Payment added",
  PAYMENT_CHANGED: "Payment changed",
  CANCELLATION: "Cancelled",
  RESCHEDULED: "Rescheduled",
  REASSIGNED: "Reassigned",
  CLIENT_NOTIFIED: "Client notified",
  STAFF_NOTIFIED: "Staff notified",
  COMPLETED: "Completed",
  NO_SHOW_MARKED: "Marked no-show",
  FLAGGED_NEEDS_ATTENTION: "Flagged for attention",
  ATTENTION_RESOLVED: "Attention resolved",
};

export function AppointmentDetailModal({
  appointmentId,
  onClose,
  onReschedule,
}: {
  appointmentId: string | null;
  onClose: () => void;
  onReschedule: () => void;
}) {
  const { user } = useAuth();
  const { data: appointment, isLoading } = useAppointment(appointmentId);
  const { data: staff } = useStaff(1, 100);
  const { data: outstanding } = useOutstandingBalance(appointmentId);
  const changeStatus = useChangeAppointmentStatus();
  const reassign = useReassignAppointment();
  const recordPayment = useRecordPayment();
  const [error, setError] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [showReassign, setShowReassign] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");

  if (!appointmentId) return null;

  const canReassign = user?.role === "OWNER" || user?.role === "MANAGER";
  const canRecordPayment = user?.role === "OWNER" || user?.role === "MANAGER";

  async function handleRecordPayment() {
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }
    setError(null);
    try {
      await recordPayment.mutateAsync({
        appointmentId: appointmentId!,
        clientId: appointment!.clientId,
        amount: nairaToKobo(amount),
        method: paymentMethod,
      });
      setShowRecordPayment(false);
      setPaymentAmount("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record this payment.");
    }
  }

  async function handleStatusChange(newStatus: AppointmentStatus) {
    setError(null);
    try {
      await changeStatus.mutateAsync({ id: appointmentId!, newStatus });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this appointment's status.");
    }
  }

  async function handleReassign() {
    if (!reassignTo) return;
    setError(null);
    try {
      await reassign.mutateAsync({ id: appointmentId!, newStaffId: reassignTo, reason: "Reassigned from the appointment detail view" });
      setShowReassign(false);
      setReassignTo("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reassign this appointment.");
    }
  }

  return (
    <Modal open onClose={onClose} title="Appointment details" size="lg">
      {isLoading || !appointment ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-ink-muted" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-display text-xl text-ink">{appointment.client?.name ?? "Client"}</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {appointment.service?.name} with {appointment.staff?.name}
              </p>
            </div>
            <StatusBadge status={appointment.status} />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-ink-muted">Date &amp; time</dt>
              <dd className="text-ink">{formatDateTime(appointment.startsAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Duration</dt>
              <dd className="text-ink">{formatDuration(appointment.durationSnapshot)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Price</dt>
              <dd className="text-ink">{formatCurrency(appointment.priceSnapshot)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Payment</dt>
              <dd className="text-ink">
                {outstanding ? (
                  outstanding.outstanding > 0 ? (
                    <span className="text-warning">{formatCurrency(outstanding.outstanding)} outstanding</span>
                  ) : (
                    <span className="text-success">Paid in full</span>
                  )
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Location</dt>
              <dd className="text-ink">{appointment.locationType === "HOME" ? appointment.homeAddress || "Home visit" : "At the salon"}</dd>
            </div>
            {appointment.notes && (
              <div className="col-span-2">
                <dt className="text-ink-muted">Notes</dt>
                <dd className="text-ink">{appointment.notes}</dd>
              </div>
            )}
          </dl>

          {appointment.needsAttention && (
            <p className="text-sm text-warning bg-warning-bg rounded-sm px-3 py-2">{appointment.attentionReason}</p>
          )}

          {error && (
            <p className="text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {allowedNextStatuses(appointment.status).map((status) => (
              <Button key={status} size="sm" variant="secondary" loading={changeStatus.isPending} onClick={() => handleStatusChange(status)}>
                Mark {STATUS_LABELS[status].toLowerCase()}
              </Button>
            ))}
            {(appointment.status === "PENDING" || appointment.status === "CONFIRMED") && (
              <Button size="sm" variant="secondary" onClick={onReschedule}>
                Reschedule
              </Button>
            )}
            {canReassign && (appointment.status === "PENDING" || appointment.status === "CONFIRMED") && (
              <Button size="sm" variant="ghost" onClick={() => setShowReassign((v) => !v)}>
                Reassign staff
              </Button>
            )}
            {canRecordPayment && outstanding && outstanding.outstanding > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowRecordPayment((v) => !v);
                  setPaymentAmount(String(koboToNaira(outstanding.outstanding)));
                }}
              >
                Record payment
              </Button>
            )}
          </div>

          {showRecordPayment && (
            <div className="flex items-end gap-2 rounded border border-line bg-paper-sunken p-3">
              <div className="w-28">
                <label className="block text-xs font-medium text-ink-soft mb-1">Amount (₦)</label>
                <Input type="number" min={0} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
              </div>
              <div className="w-36">
                <label className="block text-xs font-medium text-ink-soft mb-1">Method</label>
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="TRANSFER">Transfer</option>
                  <option value="WALLET">Wallet</option>
                  <option value="OTHER">Other</option>
                </Select>
              </div>
              <Button size="sm" loading={recordPayment.isPending} onClick={handleRecordPayment}>
                Confirm
              </Button>
            </div>
          )}

          {showReassign && (
            <div className="flex items-end gap-2 rounded border border-line bg-paper-sunken p-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-ink-soft mb-1">Reassign to</label>
                <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">Select a staff member…</option>
                  {staff?.items
                    ?.filter((s) => s.id !== appointment.staffId && s.status === "ACTIVE")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </div>
              <Button size="sm" loading={reassign.isPending} disabled={!reassignTo} onClick={handleReassign}>
                Confirm
              </Button>
            </div>
          )}

          {appointment.events && appointment.events.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-3 text-sm font-medium text-ink">History</p>
              <ol className="space-y-3">
                {appointment.events.map((event) => (
                  <li key={event.id} className="flex gap-3 text-sm">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                    <div>
                      <p className="text-ink">
                        {EVENT_LABELS[event.type] ?? event.type}
                        {event.reason ? ` — ${event.reason}` : ""}
                      </p>
                      <p className="text-xs text-ink-muted">{formatDateTime(event.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
