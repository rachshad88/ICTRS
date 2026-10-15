import { MONTHS, yearsWith, type PeriodFilter } from '../lib/periods';

/**
 * The date controls for a period filter (lib/periods.ts): a day for Day, From-To for Week, month
 * and year for Month. For All there is nothing to pick, so the day picker shows switched off.
 */
function PeriodDates({ p, className = 'tech-date' }: { p: PeriodFilter; className?: string }) {
  const { period, date, range } = p;

  if (period === 'monthly') {
    const year = Number(range.from.slice(0, 4));
    return (
      <div className="tech-range">
        <select
          className={className}
          aria-label="Month"
          value={Number(range.from.slice(5, 7)) - 1}
          onChange={(e) => p.pickMonth(range.from.slice(0, 4), String(Number(e.target.value) + 1).padStart(2, '0'))}
        >
          {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
        </select>
        <select className={className} aria-label="Year" value={year} onChange={(e) => p.pickMonth(e.target.value, range.from.slice(5, 7))}>
          {yearsWith(year).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    );
  }

  if (period === 'weekly') {
    return (
      <div className="tech-range">
        <input
          type="date"
          className={className}
          aria-label="From"
          value={range.from}
          max={range.to}
          onChange={(e) => e.target.value && p.setRange((r) => ({ ...r, from: e.target.value }))}
        />
        <span aria-hidden="true">to</span>
        <input
          type="date"
          className={className}
          aria-label="To"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && p.setRange((r) => ({ ...r, to: e.target.value }))}
        />
      </div>
    );
  }

  // "All" ignores the date, so the picker is off rather than silently doing nothing.
  return (
    <input
      type="date"
      className={className}
      aria-label="Date"
      value={date}
      disabled={period === 'all'}
      onChange={(e) => e.target.value && p.setDate(e.target.value)}
    />
  );
}

export default PeriodDates;
