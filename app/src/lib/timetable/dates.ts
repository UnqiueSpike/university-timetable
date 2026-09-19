import { Temporal } from "@js-temporal/polyfill";
export const CAMPUS_ZONE = "Australia/Sydney";
export function campusToday() { return Temporal.Now.plainDateISO(CAMPUS_ZONE).toString(); }
export function weekDates(date: string) {
  const day = Temporal.PlainDate.from(date);
  const monday = day.subtract({ days: day.dayOfWeek - 1 });
  return Array.from({ length: 7 }, (_, i) => monday.add({ days: i }).toString());
}
export function shiftWeek(date: string, weeks: number) { return Temporal.PlainDate.from(date).add({ weeks }).toString(); }
export function weekRange(date: string) {
  const first = Temporal.PlainDate.from(weekDates(date)[0]);
  return { from: first.toZonedDateTime({ timeZone: CAMPUS_ZONE, plainTime: "00:00" }).toInstant().toString(), to: first.add({ days: 7 }).toZonedDateTime({ timeZone: CAMPUS_ZONE, plainTime: "00:00" }).toInstant().toString() };
}
export function campusTime(instant: string) { return new Intl.DateTimeFormat("en-AU", { timeZone: CAMPUS_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(instant)); }
export function campusDate(instant: string) { return Temporal.Instant.from(instant).toZonedDateTimeISO(CAMPUS_ZONE).toPlainDate().toString(); }
export function formatDate(date: string, options: Intl.DateTimeFormatOptions) { return new Intl.DateTimeFormat("en-AU", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
export function minutesInDay(instant: string) { const t = Temporal.Instant.from(instant).toZonedDateTimeISO(CAMPUS_ZONE); return t.hour * 60 + t.minute; }
