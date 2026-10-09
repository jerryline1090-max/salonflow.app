import type { Appointment, StaffMember, StaffScheduleEntry } from "@/types";
import { businessDateKey, businessMinutes } from "./businessCalendar";

export function summarizeDay(appointments: Appointment[]) {
  const upcoming = appointments.filter(a => a.status === "PENDING" || a.status === "CONFIRMED");
  const trend = [["Pending", "PENDING"], ["Confirmed", "CONFIRMED"], ["Completed", "COMPLETED"], ["Cancelled", "CANCELLED"], ["No-show", "NO_SHOW"]]
    .map(([label, status]) => ({ label, value: appointments.filter(a => a.status === status).length }));
  return { count: appointments.length, upcoming, trend };
}

export function calendarColumns(appointments: Appointment[], directory: StaffMember[] = []) {
  const columns = new Map<string, { id: string; name: string; schedule?: StaffScheduleEntry[] }>();
  for (const staff of directory) if (staff.status === "ACTIVE") columns.set(staff.id, staff);
  // Historical appointments must remain visible for inactive/off/unlisted staff.
  for (const appointment of appointments) if (!columns.has(appointment.staffId)) {
    columns.set(appointment.staffId, { id: appointment.staffId, name: appointment.staff?.name ?? "Assigned staff" });
  }
  return [...columns.values()];
}

export function calendarInterval(appointment: Appointment, day: string, timezone: string) {
  const start = businessMinutes(appointment.startsAt, timezone);
  const end = businessDateKey(new Date(appointment.endsAt), timezone) > day ? 1440 : businessMinutes(appointment.endsAt, timezone);
  return { start, end: Math.max(end, start + 1) };
}

export function calendarGridBounds(appointments: Appointment[], day: string, timezone: string, open: number, close: number) {
  const intervals = appointments.map(a => calendarInterval(a, day, timezone));
  return {
    start: Math.floor(Math.min(open, ...intervals.map(a => a.start)) / 30) * 30,
    end: Math.ceil(Math.max(close, ...intervals.map(a => a.end)) / 30) * 30,
  };
}
