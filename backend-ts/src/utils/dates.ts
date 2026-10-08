// "YYYY-MM-DD HH:mm" in the app timezone (process.env.TZ, set in index.ts).
export function formatDateTime(value: Date | string): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Today's date as YYYY-MM-DD in the app timezone.
export function todayString(): string {
  return new Date().toLocaleDateString('en-CA');
}

// A real calendar day written as YYYY-MM-DD (rejects 2026-02-30 and similar).
export function isValidDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// A 24-hour HH:MM time, as sent by <input type="time">.
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// The semester a date falls in (app timezone): January-June is the 1st, July-December the 2nd.
export function semesterFor(value: Date): string {
  return value.getMonth() < 6 ? '1st Semester (January-June)' : '2nd Semester (July-December)';
}
