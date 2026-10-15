import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

// The month calendar inside DateField and DateRangeField (components/DateField.tsx), in place of
// the browser's own date popup, which can't be styled. Days are YYYY-MM-DD strings in local time,
// like the native inputs gave, so nothing shifts across timezones. Weeks start on Sunday, as the
// Week filters do (lib/periods.ts).

export interface DayRange {
  from: string;
  to: string;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS_SHORT = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en-US', { month: 'short' }));

export const toDay = (d: Date) => d.toLocaleDateString('en-CA');
export const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayString = () => toDay(new Date());
const addDays = (s: string, n: number) => {
  const d = parseDay(s);
  return toDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** The same day n months on, kept inside the target month (Jan 31 + 1 month is Feb 28). */
const addMonths = (s: string, n: number) => {
  const d = parseDay(s);
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return toDay(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last)));
};
const longLabel = (s: string) => parseDay(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

interface CommonProps {
  min?: string;
  max?: string;
  /** Shows a Clear button (for optional fields). */
  onClear?: () => void;
  /** Esc, or a pick that finishes the choice. */
  onDone: () => void;
}

type Props = CommonProps & (
  | { mode: 'single'; value: string; onPick: (day: string) => void }
  | { mode: 'range'; range: DayRange | null; onRange: (range: DayRange) => void }
);

function Calendar(props: Props) {
  const { min, max, onClear, onDone } = props;
  const today = todayString();
  const selected = props.mode === 'single' ? props.value || '' : props.range?.from || '';
  const allowed = (s: string) => (!min || s >= min) && (!max || s <= max);

  // The day with keyboard focus; the month shown follows it.
  const [focus, setFocus] = useState(() => {
    const start = selected || today;
    if (min && start < min) return min;
    if (max && start > max) return max;
    return start;
  });
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  // Range: the start picked so far, and the day under the pointer (to preview the band).
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const year = Number(focus.slice(0, 4));
  const month = Number(focus.slice(5, 7)) - 1;
  const grid = useMemo(() => {
    const first = new Date(year, month, 1);
    const lead = first.getDay();
    return Array.from({ length: 42 }, (_, i) => toDay(new Date(year, month, 1 - lead + i)));
  }, [year, month]);

  // Keep keyboard focus on the focused day as it moves.
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current || view !== 'days') return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, view]);
  // Opening puts focus on the selected (or today's) day, so the keyboard works at once.
  // A frame later: the popover is hidden for its first frame while it finds its place, and a
  // hidden element can't take focus.
  const openedOn = useRef(focus);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${openedOn.current}"]`)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const pick = (day: string) => {
    if (!allowed(day)) return;
    if (props.mode === 'single') {
      props.onPick(day);
      onDone();
      return;
    }
    // First tap starts a range; a second on or after it ends it; one before it starts over.
    if (!start || day < start) {
      setStart(day);
      setFocus(day);
      return;
    }
    props.onRange({ from: start, to: day });
    setStart(null);
    onDone();
  };

  // The band shown: the range being picked (start to the hovered day), else the saved range.
  const band: DayRange | null = props.mode === 'range'
    ? start
      ? { from: start, to: hover && hover >= start ? hover : start }
      : props.range && props.range.from && props.range.to ? props.range : null
    : null;

  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -parseDay(focus).getDay()),
      End: () => addDays(focus, 6 - parseDay(focus).getDay()),
    };
    if (step[e.key]) {
      e.preventDefault();
      moved.current = true;
      setFocus(step[e.key]());
      if (start) setHover(step[e.key]());
    }
  };

  const stepMonth = (n: number) => setFocus((f) => addMonths(f, n));
  // The year grid: twelve years with the shown one near the middle.
  const decade = year - 5;

  return (
    <div className="cal" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); } }}>
      <div className="cal-head">
        <button
          type="button"
          className="cal-step"
          aria-label={view === 'days' ? 'Previous month' : view === 'months' ? 'Previous year' : 'Previous years'}
          onClick={() => (view === 'days' ? stepMonth(-1) : stepMonth(view === 'months' ? -12 : -144))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <button
          type="button"
          className="cal-title"
          aria-live="polite"
          onClick={() => setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days')}
        >
          {view === 'days' && new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          {view === 'months' && year}
          {view === 'years' && `${decade} – ${decade + 11}`}
        </button>
        <button
          type="button"
          className="cal-step"
          aria-label={view === 'days' ? 'Next month' : view === 'months' ? 'Next year' : 'Next years'}
          onClick={() => (view === 'days' ? stepMonth(1) : stepMonth(view === 'months' ? 12 : 144))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      {view === 'days' && (
        <div className="cal-days" role="grid" aria-label="Choose a date" ref={gridRef} onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
          <div className="cal-row" role="row">
            {WEEKDAYS.map((w) => <span key={w} className="cal-weekday" role="columnheader">{w}</span>)}
          </div>
          {Array.from({ length: 6 }, (_, r) => (
            <div className="cal-row" role="row" key={r}>
              {grid.slice(r * 7, r * 7 + 7).map((day) => {
                const inMonth = Number(day.slice(5, 7)) - 1 === month;
                const ok = allowed(day);
                const inBand = !!band && day >= band.from && day <= band.to;
                const isEnd = !!band && (day === band.from || day === band.to);
                const isSel = props.mode === 'single' ? day === selected : isEnd;
                const cls = [
                  'cal-day',
                  inMonth ? '' : 'is-out',
                  day === today ? 'is-today' : '',
                  isSel ? 'is-selected' : '',
                  inBand && !isEnd ? 'in-band' : '',
                  band && day === band.from && band.from !== band.to ? 'band-start' : '',
                  band && day === band.to && band.from !== band.to ? 'band-end' : '',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    data-day={day}
                    className={cls}
                    tabIndex={day === focus ? 0 : -1}
                    disabled={!ok}
                    aria-selected={isSel || inBand}
                    aria-current={day === today ? 'date' : undefined}
                    aria-label={longLabel(day)}
                    onClick={() => pick(day)}
                    onMouseEnter={() => start && setHover(day)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(day); } }}
                  >
                    <span>{Number(day.slice(8))}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view === 'months' && (
        <div className="cal-picks">
          {MONTHS_SHORT.map((m, i) => (
            <button
              key={m}
              type="button"
              className={`cal-pick ${i === month ? 'is-selected' : ''}`}
              onClick={() => { setFocus(toDay(new Date(year, i, Math.min(parseDay(focus).getDate(), new Date(year, i + 1, 0).getDate())))); setView('days'); }}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {view === 'years' && (
        <div className="cal-picks">
          {Array.from({ length: 12 }, (_, i) => decade + i).map((y) => (
            <button
              key={y}
              type="button"
              className={`cal-pick ${y === year ? 'is-selected' : ''}`}
              onClick={() => { setFocus(addMonths(focus, (y - year) * 12)); setView('months'); }}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="cal-foot">
        {props.mode === 'range' && (
          <span className="cal-hint" aria-live="polite">{start ? 'Now pick the last day' : 'Pick the first day'}</span>
        )}
        <span className="cal-foot-actions">
          {onClear && (
            <button type="button" className="cal-link" onClick={() => { onClear(); onDone(); }}>Clear</button>
          )}
          {props.mode === 'single' && allowed(today) && (
            <button type="button" className="cal-link" onClick={() => pick(today)}>Today</button>
          )}
          {props.mode === 'range' && (
            <button type="button" className="cal-link" onClick={() => { moved.current = true; setFocus(today); setView('days'); }}>Today</button>
          )}
        </span>
      </div>
    </div>
  );
}

export default Calendar;
