import { useMemo, useState } from "react";
import { useAppointmentRange, useCalendarContext, useCalendarStaff } from "@/hooks/useAppointments";
import { calendarColumns, calendarGridBounds, calendarInterval } from "@/utils/appointmentViews";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/Alert";
import { CreateAppointmentModal } from "@/components/CreateAppointmentModal";
import { AppointmentDetailModal } from "@/components/AppointmentDetailModal";
import { RescheduleModal } from "@/components/RescheduleModal";
import { toDatetimeLocalValue } from "@/utils/format";
import { parseTimeToMinutes, formatSlotLabel } from "@/utils/time";
import { businessDateKey, businessMinutes, businessWallTime, businessCalendarRange, shiftBusinessDate } from "@/utils/businessCalendar";
import type { Appointment } from "@/types";

const ROW_HEIGHT = 48; // px per 30-minute slot
const SLOT_MINUTES = 30;
const DEFAULT_OPEN = 9 * 60; // 9:00 AM fallback if business hours aren't configured for the day
const DEFAULT_CLOSE = 20 * 60; // 8:00 PM fallback

const STATUS_BLOCK_CLASSES: Record<Appointment["status"], string> = {
  PENDING: "bg-warning-bg border-warning/50 text-warning",
  CONFIRMED: "bg-info-bg border-info/50 text-info",
  COMPLETED: "bg-success-bg border-success/50 text-success",
  CANCELLED: "bg-paper-sunken border-line text-ink-muted line-through",
  NO_SHOW: "bg-danger-bg border-danger/50 text-danger",
};

export function CalendarPage() {
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{ staffId?: string; startsAt?: string } | null>(null);

  const context = useCalendarContext();
  const business = context.data;
  const directory = useCalendarStaff(business?.canViewStaff === true);
  const timezone = business?.timezone;
  const selectedDay = chosenDay ?? businessDateKey(new Date(), timezone ?? "UTC");
  const range = timezone ? businessCalendarRange(selectedDay, timezone) : undefined;
  const appointmentQuery = useAppointmentRange(range);
  const appointments = appointmentQuery.data;
  const isError = context.isError || appointmentQuery.isError;
  const isLoading = context.isPending || appointmentQuery.isPending;

  const dayOfWeek = new Date(`${selectedDay}T12:00:00Z`).getUTCDay();
  const activeStaff = useMemo(() => calendarColumns(appointments ?? [], business?.canViewStaff ? directory.data : []), [appointments, directory.data, business?.canViewStaff]);

  const businessHoursToday = business?.workingHours?.find((w) => w.dayOfWeek === dayOfWeek);
  const businessClosedToday = businessHoursToday?.isClosed ?? true;
  const open = businessHoursToday && !businessHoursToday.isClosed ? parseTimeToMinutes(businessHoursToday.openTime) : DEFAULT_OPEN;
  const close = businessHoursToday && !businessHoursToday.isClosed ? parseTimeToMinutes(businessHoursToday.closeTime) : DEFAULT_CLOSE;
  const { start: gridStart, end: gridEnd } = calendarGridBounds(appointments ?? [], selectedDay, timezone ?? "UTC", open, close);
  const totalSlots = Math.max(Math.round((gridEnd - gridStart) / SLOT_MINUTES), 0);

  const isToday = Boolean(timezone) && businessDateKey(new Date(), timezone!) === selectedDay;
  const nowMinutes = businessMinutes(new Date().toISOString(), timezone ?? "UTC");
  const showNowLine = isToday && nowMinutes >= gridStart && nowMinutes <= gridEnd;

  function appointmentsForStaff(staffId: string): Appointment[] {
    return (appointments ?? []).filter((a) => a.staffId === staffId);
  }

  function handleSlotClick(staffId: string, slotStartMinutes: number) {
    if (!timezone) return;
    const d = businessWallTime(selectedDay, slotStartMinutes, timezone);
    setCreatePrefill({ staffId, startsAt: toDatetimeLocalValue(d.toISOString()) });
  }

  return (
    <PageContainer>
      <PageHeader title="Calendar" description="Your appointments in the salon’s timezone. Booking availability is verified when you save." actions={business?.canCreate ? <Button onClick={() => setCreatePrefill({})}>New appointment</Button> : undefined} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
        <Button size="sm" variant="secondary" onClick={() => setChosenDay(shiftBusinessDate(selectedDay, -1))} aria-label="Previous day">
          ←
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setChosenDay(null)}>
          Today
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setChosenDay(shiftBusinessDate(selectedDay, 1))} aria-label="Next day">
          →
        </Button>
        <p className="ml-1 font-display text-lg text-ink">{`${selectedDay} · ${timezone ?? "Loading timezone…"}`}</p>
      </div>

      <Card className="overflow-hidden">
        {isError ? <Alert tone="error" className="m-5">{appointmentQuery.error?.message ?? "The complete calendar could not be loaded."} <Button size="sm" variant="secondary" onClick={() => { void context.refetch(); if (timezone) void appointmentQuery.refetch(); }}>Retry</Button></Alert> : !timezone || isLoading ? <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded bg-paper-sunken" /><div className="h-72 animate-pulse rounded bg-paper-sunken" /></div> : businessClosedToday && appointments?.length === 0 ? (
          <EmptyState title="Closed today" description="This salon isn't open on this day, and your calendar has no appointments." />
        ) : activeStaff.length === 0 ? (
          <EmptyState title="No appointments for this day" description={business?.canViewStaff && directory.isPending ? "Staff columns are still loading." : "No appointments are scheduled in your authorized calendar."} />
        ) : (
          <div className="relative flex overflow-x-auto scrollbar-thin">
            {/* Time labels */}
            <div className="sticky left-0 z-10 w-16 shrink-0 bg-paper-raised border-r border-line">
              <div className="h-10 border-b border-line" />
              <div className="relative" style={{ height: totalSlots * ROW_HEIGHT }}>
                {Array.from({ length: totalSlots }).map((_, i) => {
                  const minutes = gridStart + i * SLOT_MINUTES;
                  if (minutes % 60 !== 0) return null;
                  return (
                    <p
                      key={i}
                      className="absolute -translate-y-1/2 pr-2 text-right w-full text-xs text-ink-muted"
                      style={{ top: i * ROW_HEIGHT }}
                    >
                      {formatSlotLabel(minutes)}
                    </p>
                  );
                })}
              </div>
            </div>

            {/* Staff columns */}
            {activeStaff.map((member) => {
              const schedule = member.schedule?.find((s) => s.dayOfWeek === dayOfWeek);
              const isOff = schedule?.isOff === true;

              return (
                <div key={member.id} className="w-44 shrink-0 border-r border-line">
                  <div className="h-10 flex items-center justify-center border-b border-line px-2">
                    <p className="truncate text-sm font-medium text-ink">{member.name}</p>
                  </div>
                  <div className="relative" style={{ height: totalSlots * ROW_HEIGHT }}>
                    {isOff ? (
                      <div className="absolute inset-0 bg-paper-sunken/60 flex items-start justify-center pt-6">
                        <p className="text-xs text-ink-muted">Off today</p>
                      </div>
                    ) : schedule && business?.canCreate && !businessClosedToday ? (
                      <>
                        {Array.from({ length: totalSlots }).map((_, i) => (
                          <button
                            key={i}
                            disabled={gridStart + i * SLOT_MINUTES < Math.max(open, parseTimeToMinutes(schedule!.startTime)) || gridStart + i * SLOT_MINUTES >= Math.min(close, parseTimeToMinutes(schedule!.endTime))}
                            onClick={() => handleSlotClick(member.id, gridStart + i * SLOT_MINUTES)}
                            className="absolute inset-x-0 border-t border-line/60 enabled:hover:bg-brass-50/50 disabled:bg-paper-sunken/60 disabled:cursor-not-allowed transition-colors"
                            style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                            aria-label={`Book ${member.name} at ${formatSlotLabel(gridStart + i * SLOT_MINUTES)}`}
                          />
                        ))}
                      </>
                    ) : null}
                        {appointmentsForStaff(member.id).map((appt) => {
                          const { start: startMin, end: endMin } = calendarInterval(appt, selectedDay, timezone!);
                          const top = ((startMin - gridStart) / SLOT_MINUTES) * ROW_HEIGHT;
                          const height = Math.max(((endMin - startMin) / SLOT_MINUTES) * ROW_HEIGHT, 20);
                          return (
                            <button
                              type="button"
                              key={appt.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailId(appt.id);
                              }}
                              className={`absolute inset-x-1 overflow-hidden rounded border px-1.5 py-1 text-left cursor-pointer transition-shadow hover:ring-1 hover:ring-brass-500 focus-visible:bg-brass-50 focus-visible:ring-2 focus-visible:ring-brass-500 ${STATUS_BLOCK_CLASSES[appt.status]}`}
                              style={{ top, height }}
                            >
                              <p className="truncate text-xs font-medium">{appt.client?.name}</p>
                              {height > 32 && <p className="truncate text-[11px] opacity-80">{appt.service?.name}</p>}
                            </button>
                          );
                        })}
                  </div>
                </div>
              );
            })}

            {showNowLine && (
              <div
                className="pointer-events-none absolute left-16 right-0 z-20 border-t-2 border-danger"
                style={{ top: 40 + ((nowMinutes - gridStart) / SLOT_MINUTES) * ROW_HEIGHT }}
              />
            )}
          </div>
        )}
      </Card>

      {business?.canViewStaff && directory.isError && <Alert tone="warning" className="mt-3">Staff availability columns could not be loaded. All fetched appointments remain visible. <Button size="sm" variant="secondary" onClick={() => void directory.refetch()}>Retry staff</Button></Alert>}

      <p className="mt-2 text-xs text-ink-muted md:hidden">Swipe horizontally to view each staff member’s schedule.</p>
      {business?.canCreate && createPrefill !== null && <CreateAppointmentModal open onClose={() => setCreatePrefill(null)} prefill={createPrefill} />}
      <AppointmentDetailModal
        appointmentId={detailId}
        onClose={() => setDetailId(null)}
        onReschedule={() => {
          const appt = appointments?.find((a) => a.id === detailId);
          if (appt) {
            setRescheduleTarget(appt);
            setDetailId(null);
          }
        }}
      />
      <RescheduleModal appointment={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />
    </PageContainer>
  );
}
