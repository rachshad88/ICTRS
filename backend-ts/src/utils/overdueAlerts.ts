import type { Collection } from 'mongodb';
import type { Role } from '../config/database';
import { notify } from './notify';
import { overdueExpr } from './priority';

// Overdue alerts: every 30 minutes, find open requests whose due (or event/target) day has passed
// and notify the assigned staff member and the service's admins once. A request alerts once per
// deadline: `overdue_alerted_for` records the date it was alerted for, so moving the date and
// missing the new one alerts again. "Overdue" is the same rule the dashboards flag (overdueExpr).

export interface OverdueWatch {
  label: string;                   // "IT", "Multimedia", ... as shown in the alert
  getCollection: () => Collection<any>;
  dueField: string;                // due_date | event_date | target_date
  summaryField: string;            // a short description of the request, e.g. issue or event_title
  adminRoles: Role[];              // who assigns this service's requests
  pages: { staff: string; admin: string };
}

const CHECK_MS = 30 * 60 * 1000;
const watches: OverdueWatch[] = [];

/** Called once per request type when its routes are set up. */
export function watchOverdue(watch: OverdueWatch): void {
  watches.push(watch);
}

function clip(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function checkOne(w: OverdueWatch): Promise<number> {
  const due = `$${w.dueField}`;
  const collection = w.getCollection();
  const overdue = await collection
    .find({ $expr: { $and: [overdueExpr(due), { $ne: ['$overdue_alerted_for', due] }] } })
    .project({ request_code: 1, status: 1, assigned_to: 1, [w.dueField]: 1, [w.summaryField]: 1 })
    .toArray();

  let sent = 0;
  for (const r of overdue) {
    const dueDate: Date = r[w.dueField];
    // Claim the alert first, so two checks running close together can't both send it.
    const claimed = await collection.updateOne(
      { _id: r._id, overdue_alerted_for: { $ne: dueDate } },
      { $set: { overdue_alerted_for: dueDate } },
    );
    if (claimed.modifiedCount !== 1) continue;

    const summary = String(r[w.summaryField] ?? '').trim();
    const status = String(r.status || '').replace(/_/g, ' ').toLowerCase();
    const state = r.assigned_to || status === 'unassigned' ? `is still ${status}` : `is still ${status} with nobody assigned`;
    const message = `${w.label} request ${r.request_code} was due ${dayLabel(dueDate)} and ${state}`
      + (summary ? `: ${clip(summary)}` : '.');
    const alert = { level: 'warning' as const, title: 'Request overdue', request_code: r.request_code, message };
    if (r.assigned_to) notify(r.assigned_to, { ...alert, link: w.pages.staff });
    // The assignee may also be an admin; they already got the alert above.
    notify({ roles: w.adminRoles }, { ...alert, link: w.pages.admin }, r.assigned_to?.toString());
    sent++;
  }
  return sent;
}

export async function checkOverdue(): Promise<void> {
  for (const w of watches) {
    try {
      const sent = await checkOne(w);
      if (sent > 0) console.log(`Overdue alerts: ${sent} ${w.label} request(s)`);
    } catch (error) {
      console.error(`Overdue check failed for ${w.label}:`, error);
    }
  }
}

/** Checks now and every 30 minutes. Call once the database is connected. */
export function startOverdueAlerts(): void {
  void checkOverdue();
  setInterval(() => { void checkOverdue(); }, CHECK_MS).unref();
}
