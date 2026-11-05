// Local calendar dates as "YYYY-MM-DD" strings. These compare correctly as strings.

export type Day = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function toDay(d: Date): Day {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(now: Date = new Date()): Day {
  return toDay(now);
}

export function parseDay(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function diffDays(a: Day, b: Day): number {
  // whole days from b to a
  return Math.round((parseDay(a).getTime() - parseDay(b).getTime()) / 86400000);
}

/** Monday of the week containing `day`. */
export function weekStart(day: Day): Day {
  const d = parseDay(day);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  return addDays(day, -dow);
}

export function weekDays(day: Day): Day[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function fmtDay(day: Day, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return parseDay(day).toLocaleDateString(undefined, opts);
}

export function relDay(day: Day, from: Day): string {
  const n = diffDays(day, from);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** ISO week label like "2026-W45". */
export function isoWeek(day: Day): string {
  const d = parseDay(day);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week =
    1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${pad(week)}`;
}
