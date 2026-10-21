import { Request } from 'express';
import { todayString } from './dates';

// The date periods of the Reports page and the admin dashboard: filter=all|daily|weekly|monthly
// with a date, or filter=range with from/to (what the frontend's lib/periods.ts sends).

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// filter=range: from/to calendar days (YYYY-MM-DD), both included; the Reports page sends these
// for its Weekly and Monthly views. Undefined when they are missing or not dates.
export function parseRange(query: Request['query']): { from: string; to: string } | undefined {
  const from = String(query.from || '');
  const to = String(query.to || '');
  if (!DAY.test(from) || !DAY.test(to)) return undefined;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function getDateRange(filterType: string, selectedDate: string, range?: { from: string; to: string }): { startDate: Date; endDate: Date } {
  if (filterType === 'range' && range) {
    return { startDate: new Date(range.from + 'T00:00:00'), endDate: new Date(range.to + 'T23:59:59.999') };
  }
  if (filterType === 'all') {
    return { startDate: new Date(0), endDate: new Date('2099-12-31T23:59:59') };
  }
  if (filterType === 'daily') {
    return {
      startDate: new Date(selectedDate + 'T00:00:00'),
      endDate: new Date(selectedDate + 'T23:59:59'),
    };
  }
  if (filterType === 'weekly') {
    const date = new Date(selectedDate);
    const day = date.getDay();
    const startDate = new Date(date);
    startDate.setDate(date.getDate() - day);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  }
  const date = new Date(selectedDate);
  const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startDate, endDate };
}

/** The period a request asks for (filter, date, from/to) and its time window; null for a broken range. */
export function periodOf(req: Request, defaultFilter = 'monthly') {
  const filterType = (req.query.filter as string) || defaultFilter;
  const selectedDate = (req.query.date as string) || todayString();
  const range = parseRange(req.query);
  if (filterType === 'range' && !range) return null;
  return { filterType, selectedDate, range, ...getDateRange(filterType, selectedDate, range) };
}
