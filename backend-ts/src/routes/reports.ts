import { Router, Response } from 'express';
import { ObjectId, Collection, Document } from 'mongodb';
import * as XLSX from 'xlsx';
import {
  getRequestsCollection, getMultimediaRequestsCollection, getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection, getUsersCollection, USER_NAME_FIELDS
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { formatDateTime, todayString } from '../utils/dates';
import { parseRange, getDateRange, periodOf } from '../utils/periods';

const router = Router();

import { Role } from '../config/database';
import { COMPLETED_STATUSES } from '../utils/priority';

interface TypeConfig {
  getCollection: () => Collection<Document>;
  typeLabel: string;
  roleAccess: Role[];
  filterAssigned: boolean;
}

const TYPE_MAP: Record<string, () => TypeConfig> = {
  'it': () => ({
    getCollection: () => getRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'IT Request',
    roleAccess: ['ADMIN', 'TECHNICIAN', 'IT_ADMIN'],
    filterAssigned: true,
  }),
  'multimedia': () => ({
    getCollection: () => getMultimediaRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Event Documentation',
    roleAccess: ['ADMIN', 'MULTIMEDIA', 'MULTIMEDIA_ADMIN'],
    filterAssigned: true,
  }),
  'digital-media': () => ({
    getCollection: () => getDigitalMediaRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Digital Media',
    roleAccess: ['ADMIN', 'MULTIMEDIA', 'MULTIMEDIA_ADMIN'],
    filterAssigned: true,
  }),
  'print-materials': () => ({
    getCollection: () => getPrintMaterialsRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Print Materials',
    roleAccess: ['ADMIN', 'MULTIMEDIA', 'MULTIMEDIA_ADMIN'],
    filterAssigned: true,
  }),
};

const TYPE_LIST = ['it', 'multimedia', 'digital-media', 'print-materials'];

function buildFilter(
  dateFilter: Record<string, unknown>,
  showDone: boolean,
  search?: string,
  typeKey?: string,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { created_at: dateFilter };

  if (!showDone) {
    filter.status = { $nin: COMPLETED_STATUSES };
  }

  if (search && typeKey) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    const searchFields: Record<string, unknown>[] = [{ request_code: regex }, { remarks: regex }];
    if (typeKey === 'it') {
      searchFields.push({ issue: regex }, { office: regex }, { unit: regex }, { recommendation: regex });
    } else if (typeKey === 'multimedia') {
      searchFields.push({ event_title: regex }, { specific_location: regex }, { recommendation: regex });
    } else if (typeKey === 'digital-media') {
      searchFields.push({ digital_media_description: regex }, { event_ppa_name: regex }, { requestor_name: regex });
    } else if (typeKey === 'print-materials') {
      searchFields.push({ printed_media_description: regex }, { event_ppa_name: regex }, { requestor_name: regex });
    }
    filter.$or = searchFields;
  }

  return filter;
}

function addUserInfo(doc: Record<string, unknown>, userMap: Map<string, { first_name: string; last_name: string }>) {
  const creator = doc.created_by ? userMap.get(doc.created_by.toString()) : null;
  const technician = doc.assigned_to ? userMap.get(doc.assigned_to.toString()) : null;
  return {
    ...doc,
    _id: doc._id?.toString(),
    client_name: creator ? `${creator.first_name} ${creator.last_name}` : 'Unknown',
    technician_name: technician ? `${technician.first_name} ${technician.last_name}` : '-',
  };
}

async function queryType(
  typeKey: string,
  roles: string[],
  userId: string,
  filterType: string,
  selectedDate: string,
  showDone: boolean,
  search?: string,
  page?: number,
  limit?: number,
  range?: { from: string; to: string },
): Promise<{ reports: Record<string, unknown>[]; total: number }> {
  const config = TYPE_MAP[typeKey]?.();
  if (!config) return { reports: [], total: 0 };

  const { startDate, endDate } = getDateRange(filterType, selectedDate, range);
  const dateFilter = { $gte: startDate, $lte: endDate };
  const filter = buildFilter(dateFilter, showDone, search, typeKey);

  // ADMIN sees everything. A type-specific admin (IT_ADMIN, MULTIMEDIA_ADMIN) sees every request of the
  // types they have access to; they assign work rather than being assigned it, so filtering by
  // assigned_to would leave their reports empty. Technicians and staff still see only their own.
  const seesAll = roles.some(r => config.roleAccess.includes(r as Role) && r.includes('ADMIN'));
  if (config.filterAssigned && !seesAll) {
    filter.assigned_to = new ObjectId(userId);
  }

  const usersCollection = getUsersCollection();
  const allUsers = await usersCollection.find({}).project(USER_NAME_FIELDS).toArray();
  const userMap = new Map<string, { first_name: string; last_name: string }>();
  allUsers.forEach(u => {
    userMap.set(u._id!.toString(), { first_name: u.first_name, last_name: u.last_name });
  });

  const total = await config.getCollection().countDocuments(filter);
  const p = page || 1;
  const l = limit || total || 10;
  const docs = await config.getCollection().find(filter)
    .sort({ created_at: -1 })
    .skip((p - 1) * l)
    .limit(l)
    .toArray();
  const reports = docs.map(d => addUserInfo(d as unknown as Record<string, unknown>, userMap));

  return { reports, total };
}

router.get('/get_reports', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const roles = req.user!.roles;

    if (roles.includes('CLIENT') && roles.length === 1) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const typeKey = (req.query.type as string) || 'it';
    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || todayString();
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));

    const config = TYPE_MAP[typeKey]?.();
    if (!config || !config.roleAccess.some(r => roles.includes(r))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const range = parseRange(req.query);
    if (filterType === 'range' && !range) {
      res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
      return;
    }
    const result = await queryType(typeKey, roles, userId, filterType, selectedDate, showDone, search, page, limit, range);
    // Not cached: the page refreshes live when a request changes, and a cached copy would lag.
    res.json({ ...result, page, limit, totalPages: Math.ceil(result.total / limit) });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

router.get('/export_excel', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const roles = req.user!.roles;

    if (roles.includes('CLIENT') && roles.length === 1) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const typeKey = (req.query.type as string) || 'it';
    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || todayString();
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;

    const config = TYPE_MAP[typeKey]?.();
    if (!config || !config.roleAccess.some(r => roles.includes(r))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const range = parseRange(req.query);
    if (filterType === 'range' && !range) {
      res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
      return;
    }
    const { reports } = await queryType(typeKey, roles, userId, filterType, selectedDate, showDone, search, undefined, undefined, range);
    if (reports.length === 0) {
      res.status(404).json({ error: 'No reports found' });
      return;
    }

    // notes and declined_by hold objects and ids, so they are left out of the spreadsheet.
    const internalFields = new Set(['_id', 'created_by', 'assigned_to', 'created_at', 'notes', 'declined_by']);
    // Union of every row's keys, in first-seen order. Using only the first row would drop columns
    // such as decline_reason whenever that row was not declined.
    const headerSet = new Set<string>();
    for (const r of reports) {
      for (const k of Object.keys(r)) {
        if (!internalFields.has(k)) headerSet.add(k);
      }
    }
    const headers = [...headerSet];
    const excelRows = reports.map(r => {
      const row: Record<string, unknown> = {};
      for (const h of headers) {
        let val = r[h];
        if (val instanceof Date) {
          val = formatDateTime(val);
        }
        row[h] = val ?? '-';
      }
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reports');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${typeKey}_${range ? `${range.from}_to_${range.to}` : `${filterType}_${selectedDate}`}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

// --- Turnaround ------------------------------------------------------------------------------
// How fast requests are handled, per service and per staff member: from submitted to assigned
// (wait), assigned to finished (work), and submitted to completed (total), plus late, reopened and
// the backlog. Times are calendar time (nights and weekends count) and shown as the median, so one
// request left open for weeks doesn't swamp the rest; the export also has averages.

const TURNAROUND: Record<string, { label: string; due: string; adminRole: Role; staffRole: Role }> = {
  'it': { label: 'IT', due: 'due_date', adminRole: 'IT_ADMIN', staffRole: 'TECHNICIAN' },
  'multimedia': { label: 'Event Documentation', due: 'event_date', adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA' },
  'digital-media': { label: 'Digital Media', due: 'target_date', adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA' },
  'print-materials': { label: 'Print Materials', due: 'target_date', adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA' },
};
const OPEN = ['PENDING', 'UNASSIGNED', 'IN_PROGRESS', 'FOR_VERIFICATION'];
const DAY_MS = 24 * 60 * 60 * 1000;

interface Times { median: number | null; average: number | null; count: number }

/** Median and average of durations in milliseconds; null when there are none. */
function summarize(values: number[]): Times {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length === 0) return { median: null, average: null, count: 0 };
  const mid = Math.floor(v.length / 2);
  return {
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    average: v.reduce((a, b) => a + b, 0) / v.length,
    count: v.length,
  };
}

const ms = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? b.getTime() - a.getTime() : NaN);
// Late as the Overdue flag counts it: finished after the whole due day had passed.
const isLate = (due: unknown, done: unknown) => due instanceof Date && done instanceof Date && done.getTime() >= due.getTime() + DAY_MS;
// When the staff member finished: for IT the MOV they sent (the admin's check comes after).
const workEnd = (d: Document) => (d.mov?.submitted_at instanceof Date ? d.mov.submitted_at : d.completed_at);

interface StaffAcc { name: string; services: Set<string>; work: number[]; finished: number; late: number; withDue: number; reopened: number; openNow: number }

async function turnaround(roles: string[], userId: string, startDate: Date, endDate: Date) {
  const inPeriod = { $gte: startDate, $lte: endDate };
  const users = await getUsersCollection().find({}).project(USER_NAME_FIELDS).toArray();
  const names = new Map(users.map((u) => [u._id!.toString(), `${u.first_name} ${u.last_name}`.trim()]));
  const staff = new Map<string, StaffAcc>();
  const person = (id: string) => {
    // Work done by someone whose account was deleted since still counts, under this name.
    if (!staff.has(id)) staff.set(id, { name: names.get(id) || 'Removed account', services: new Set(), work: [], finished: 0, late: 0, withDue: 0, reopened: 0, openNow: 0 });
    return staff.get(id)!;
  };

  const services = [];
  for (const typeKey of TYPE_LIST) {
    const t = TURNAROUND[typeKey];
    const config = TYPE_MAP[typeKey]();
    if (!config.roleAccess.some((r) => roles.includes(r))) continue;
    // Admins of the service see everyone; its staff see only the requests assigned to them.
    const seesAll = roles.includes('ADMIN') || roles.includes(t.adminRole);
    // Some older media records hold the assignee's id as a string.
    const mine = seesAll ? {} : { assigned_to: { $in: [new ObjectId(userId), userId] } };
    const col = config.getCollection();
    const fields = { created_at: 1, accepted_at: 1, completed_at: 1, 'mov.submitted_at': 1, assigned_to: 1, [t.due]: 1 };

    const [finished, assigned, reopened, openDocs] = await Promise.all([
      col.find({ ...mine, status: { $in: COMPLETED_STATUSES }, completed_at: inPeriod }).project(fields).toArray(),
      col.find({ ...mine, accepted_at: inPeriod }).project(fields).toArray(),
      col.find({ ...mine, reopened_at: inPeriod }).project({ assigned_to: 1 }).toArray(),
      col.find({ ...mine, status: { $in: OPEN } }).project({ status: 1, assigned_to: 1, created_at: 1 }).toArray(),
    ]);

    const withDue = finished.filter((d) => d[t.due] instanceof Date);
    const waiting = openDocs.filter((d) => !d.assigned_to);
    const oldestWaiting = waiting.reduce<Date | null>((o, d) => (d.created_at instanceof Date && (!o || d.created_at < o) ? d.created_at : o), null);
    services.push({
      key: typeKey,
      label: t.label,
      finished: finished.length,
      wait: summarize(assigned.map((d) => ms(d.created_at, d.accepted_at))),
      work: summarize(finished.map((d) => ms(d.accepted_at, workEnd(d)))),
      // IT only: from the MOV being sent to the admin verifying it.
      check: typeKey === 'it' ? summarize(finished.map((d) => ms(d.mov?.submitted_at, d.completed_at))) : null,
      total: summarize(finished.map((d) => ms(d.created_at, d.completed_at))),
      late: withDue.filter((d) => isLate(d[t.due], d.completed_at)).length,
      with_due: withDue.length,
      reopened: reopened.length,
      open_now: openDocs.length,
      waiting_now: waiting.length,
      oldest_waiting: oldestWaiting,
    });

    for (const d of finished) {
      if (!d.assigned_to) continue;
      const p = person(d.assigned_to.toString());
      p.services.add(t.label);
      p.finished++;
      p.work.push(ms(d.accepted_at, workEnd(d)));
      if (d[t.due] instanceof Date) {
        p.withDue++;
        if (isLate(d[t.due], d.completed_at)) p.late++;
      }
    }
    for (const d of reopened) if (d.assigned_to) person(d.assigned_to.toString()).reopened++;
    for (const d of openDocs) {
      if (!d.assigned_to) continue;
      const p = person(d.assigned_to.toString());
      p.services.add(t.label);
      p.openNow++;
    }
  }

  const people = [...staff.entries()]
    .map(([id, p]) => ({ id, name: p.name, services: [...p.services], finished: p.finished, work: summarize(p.work), late: p.late, with_due: p.withDue, reopened: p.reopened, open_now: p.openNow }))
    .sort((a, b) => b.finished - a.finished || b.open_now - a.open_now || a.name.localeCompare(b.name));
  return { services, staff: people };
}

router.get('/turnaround', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const roles = req.user!.roles;
    if (roles.includes('CLIENT') && roles.length === 1) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const period = periodOf(req);
    if (!period) {
      res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
      return;
    }
    res.json({ from: period.startDate, to: period.endDate, ...(await turnaround(roles, req.user!.user_id, period.startDate, period.endDate)) });
  } catch (error) {
    console.error('Turnaround report error:', error);
    res.status(500).json({ error: 'Failed to build the turnaround report' });
  }
});

/** Hours, rounded to one decimal, for the spreadsheet; blank when there is nothing to measure. */
const hours = (v: number | null) => (v === null ? '' : Math.round((v / 3600000) * 10) / 10);
const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '');

router.get('/turnaround/export_excel', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const roles = req.user!.roles;
    if (roles.includes('CLIENT') && roles.length === 1) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const period = periodOf(req);
    if (!period) {
      res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
      return;
    }
    const { services, staff } = await turnaround(roles, req.user!.user_id, period.startDate, period.endDate);

    const serviceRows = services.map((s) => ({
      'Service': s.label,
      'Finished': s.finished,
      'Wait for assignment, median (h)': hours(s.wait.median),
      'Wait for assignment, average (h)': hours(s.wait.average),
      'Work time, median (h)': hours(s.work.median),
      'Work time, average (h)': hours(s.work.average),
      'MOV check, median (h)': s.check ? hours(s.check.median) : '',
      'Total, median (h)': hours(s.total.median),
      'Total, average (h)': hours(s.total.average),
      'Late': s.late,
      'Late (% of those with a due date)': percent(s.late, s.with_due),
      'Reopened': s.reopened,
      'Open now': s.open_now,
      'Waiting for assignment now': s.waiting_now,
      'Oldest waiting since': s.oldest_waiting ? formatDateTime(s.oldest_waiting) : '',
    }));
    const staffRows = staff.map((p) => ({
      'Staff member': p.name,
      'Services': p.services.join(', '),
      'Finished': p.finished,
      'Work time, median (h)': hours(p.work.median),
      'Work time, average (h)': hours(p.work.average),
      'Late': p.late,
      'Late (% of those with a due date)': percent(p.late, p.with_due),
      'Reopened': p.reopened,
      'Assigned and open now': p.open_now,
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(serviceRows), 'By service');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(staffRows.length ? staffRows : [{ 'Staff member': 'No finished or open work in this period' }]), 'By staff member');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    const { filterType, selectedDate, range } = period;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=turnaround_${range ? `${range.from}_to_${range.to}` : `${filterType}_${selectedDate}`}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Turnaround export error:', error);
    res.status(500).json({ error: 'Failed to export the turnaround report' });
  }
});

export default router;
