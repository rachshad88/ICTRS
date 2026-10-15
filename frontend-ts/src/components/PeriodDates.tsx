import { MONTHS, yearsWith, type PeriodFilter } from '../lib/periods';
import { DateField, DateRangeField } from './DateField';
import Select from './Select';

/**
 * The date controls for a period filter (lib/periods.ts): a day for Day, a From-To range on one
 * calendar for Week, month and year for Month. For All there is nothing to pick, so the day
 * picker shows switched off.
 */
function PeriodDates({ p, className = 'tech-date' }: { p: PeriodFilter; className?: string }) {
  const { period, date, range } = p;

  if (period === 'monthly') {
    const year = Number(range.from.slice(0, 4));
    return (
      <div className="tech-range">
        <Select
          className={className}
          aria-label="Month"
          value={Number(range.from.slice(5, 7)) - 1}
          onChange={(e) => p.pickMonth(range.from.slice(0, 4), String(Number(e.target.value) + 1).padStart(2, '0'))}
        >
          {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
        </Select>
        <Select className={className} aria-label="Year" value={year} onChange={(e) => p.pickMonth(e.target.value, range.from.slice(5, 7))}>
          {yearsWith(year).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
    );
  }

  if (period === 'weekly') {
    // One calendar: the first tap starts the range, the second ends it.
    return <DateRangeField className={className} aria-label="Dates" range={range} onChange={p.setRange} />;
  }

  // "All" ignores the date, so the picker is off rather than silently doing nothing.
  return <DateField className={className} aria-label="Date" value={date} disabled={period === 'all'} onChange={p.setDate} />;
}

export default PeriodDates;
