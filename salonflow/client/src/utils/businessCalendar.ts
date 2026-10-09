function parts(date: Date, timezone: string) {
  const fields = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(fields.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}
export function businessDateKey(date: Date, timezone: string) {
  const p = parts(date, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function shiftBusinessDate(day: string, offset: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function businessMinutes(instant: string, timezone: string) {
  const p = parts(new Date(instant), timezone);
  return Number(p.hour) * 60 + Number(p.minute);
}
export function businessWallTime(day: string, minutes: number, timezone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60);
  const offsetAt = (value: number) => {
    const p = parts(new Date(value), timezone);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - value;
  };
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  const result = new Date(instant);
  if (businessDateKey(result, timezone) !== day || businessMinutes(result.toISOString(), timezone) !== minutes) throw new Error("This local time does not exist in the salon timezone.");
  return result;
}
export function businessCalendarRange(day: string, timezone: string) {
  return { from: businessWallTime(day, 0, timezone).toISOString(), to: new Date(+businessWallTime(shiftBusinessDate(day, 1), 0, timezone) - 1).toISOString() };
}
