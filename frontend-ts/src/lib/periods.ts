import { useState } from 'react';

// Day / Week / Month filters shared by the IT assign dashboard and the Reports page. Week shows a
// From-To range, starting on the week (Sunday to Saturday) around a day, which can then be moved
// or widened. Month is picked by name and year. Both are sent to the server as filter=range.

export interface DayRange {
  from: string;
  to: string;
}

export const isRangePeriod = (p: string) => p === 'weekly' || p === 'monthly';

/** The week (Sunday to Saturday) or month around a day, as YYYY-MM-DD days. */
export function periodRange(period: string, day: string): DayRange {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const start = period === 'monthly' ? new Date(y, m - 1, 1) : new Date(y, m - 1, d - date.getDay());
  const end = period === 'monthly' ? new Date(y, m, 0) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { from: start.toLocaleDateString('en-CA'), to: end.toLocaleDateString('en-CA') };
}

export const sameRange = (a: DayRange, b: DayRange) => a.from === b.from && a.to === b.to;

export const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en-US', { month: 'long' }));
const THIS_YEAR = new Date().getFullYear();
/** Years offered for Month, newest first; a year already picked stays in the list. */
export const yearsWith = (year: number) => {
  const years = Array.from({ length: 6 }, (_, i) => THIS_YEAR - i);
  return years.includes(year) ? years : [...years, year].sort((a, b) => b - a);
};

const today = () => new Date().toLocaleDateString('en-CA');

/**
 * The state behind a period filter: the period, the day for Day, and the range for Week and Month.
 * `query` is what to send the server: { filter, date } or { filter: 'range', from, to }.
 */
export function usePeriodFilter(initial = 'daily') {
  const [period, setPeriod] = useState(initial);
  const [date, setDate] = useState(today);
  const [range, setRange] = useState<DayRange>(() => periodRange(isRangePeriod(initial) ? initial : 'weekly', today()));
  const ranged = isRangePeriod(period);

  // A new period starts from the day being looked at: that day while it is inside the range shown,
  // else the range's first day (so going Month and back to Day returns to the same day).
  const choosePeriod = (next: string) => {
    const anchor = ranged && (date < range.from || date > range.to) ? range.from : date;
    if (isRangePeriod(next)) setRange(periodRange(next, anchor));
    else setDate(anchor);
    setPeriod(next);
  };

  // Picking a month also makes its first day the day being looked at, so Week and back to Month
  // return to that month (a week starting late in the month before would otherwise pull it back).
  const pickMonth = (year: string, month: string) => {
    const first = `${year}-${month}-01`;
    setDate(first);
    setRange(periodRange('monthly', first));
  };

  // True while the range is still exactly the week or month (headings can say "This week").
  const rangeIsPeriod = ranged && sameRange(periodRange(period, range.from), range);
  const query: Record<string, string> = ranged ? { filter: 'range', from: range.from, to: range.to } : { filter: period, date };

  return { period, date, range, ranged, rangeIsPeriod, query, choosePeriod, setDate, setRange, pickMonth };
}

export type PeriodFilter = ReturnType<typeof usePeriodFilter>;
