// The data of the Reports page's Turnaround view, from GET /api/reports/turnaround
// (backend-ts/src/routes/reports.ts), and how its numbers are written. Shared by the tables
// (components/TurnaroundReport.tsx) and the charts (components/TurnaroundCharts.tsx).

export interface Times {
  median: number | null;
  average: number | null;
  count: number;
}

export interface ServiceRow {
  key: string;
  label: string;
  finished: number;
  wait: Times;
  work: Times;
  check: Times | null;
  total: Times;
  late: number;
  with_due: number;
  reopened: number;
  open_now: number;
  waiting_now: number;
  oldest_waiting: string | null;
}

export interface StaffRow {
  id: string;
  name: string;
  services: string[];
  finished: number;
  work: Times;
  late: number;
  with_due: number;
  reopened: number;
  open_now: number;
}

export interface TurnaroundData {
  services: ServiceRow[];
  staff: StaffRow[];
}

const HOUR = 3600000;

/** A duration as people say it: "under 1 min", "45 min", "3.5 h", "2.1 days". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 60000) return 'under 1 min';
  if (ms < HOUR) return `${Math.round(ms / 60000)} min`;
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (ms < 48 * HOUR) return `${trim(ms / HOUR)} h`;
  return `${trim(ms / (24 * HOUR))} days`;
}

export const lateText = (late: number, withDue: number) => (withDue ? `${late} (${Math.round((late / withDue) * 100)}%)` : '-');

export const sinceText = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
