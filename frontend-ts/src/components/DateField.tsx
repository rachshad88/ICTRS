import { useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Popup from './Popup';
import Calendar, { parseDay, type DayRange } from './Calendar';

// Date fields in ITRS's own style, in place of <input type="date"> (whose calendar can't be
// styled and differs on every browser). On desktop the calendar drops from the field as a popover;
// on phones it rises as a bottom sheet. Values stay YYYY-MM-DD strings, as the native input gave.

const fmtDay = (s: string, withYear = true) =>
  parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });

/** "Oct 11 – Oct 17, 2026", or with both years when the range crosses one. */
export function formatRange(r: DayRange) {
  if (r.from === r.to) return fmtDay(r.from);
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  return `${fmtDay(r.from, !sameYear)} – ${fmtDay(r.to)}`;
}

const CalendarIcon = () => (
  <svg className="date-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </svg>
);

interface FieldBase {
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Class for the field button, to match the inputs around it (e.g. tech-date on dashboards). */
  className?: string;
  'aria-label'?: string;
}

/** Open state for a field's popup, shared with TimeField. */
export function useOpen() {
  const [open, setOpenState] = useState(false);
  // Each open is a new calendar: one reopened while the last still drains gets its own.
  const [openCount, setOpenCount] = useState(0);
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (value && !open) setOpenCount((n) => n + 1);
    setOpenState(value);
  };
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  return { open, setOpen, button, close, openCount };
}

/** One day. `onClear` adds a Clear button, for fields that may be left empty. */
export function DateField({ value, onChange, onClear, required, name, id, min, max, disabled, placeholder = 'Pick a date', className = '', ...rest }: FieldBase & {
  value: string;
  onChange: (day: string) => void;
  onClear?: () => void;
  required?: boolean;
  name?: string;
}) {
  const { open, setOpen, button, close, openCount } = useOpen();
  return (
    <span className="date-field">
      <button
        ref={button}
        id={id}
        type="button"
        className={`date-field-button ${value ? '' : 'is-empty'} ${className}`.trim()}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest['aria-label'] ? `${rest['aria-label']}: ${value ? fmtDay(value) : 'not set'}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="date-field-text">{value ? fmtDay(value) : placeholder}</span>
        <CalendarIcon />
      </button>
      {/* Carries the required check and the name for the form; the browser points its message here. */}
      {(required || name) && (
        <input
          className="date-field-validity"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          value={value}
          onChange={() => {}}
          onFocus={() => button.current?.focus()}
          required={required}
        />
      )}
      <AnimatePresence>
        {open && (
          <Popup key={openCount} anchor={button.current} title={rest['aria-label'] || 'Choose a date'} onClose={close} width={304}>
            <Calendar mode="single" value={value} min={min} max={max} onPick={onChange} onClear={onClear} onDone={close} />
          </Popup>
        )}
      </AnimatePresence>
    </span>
  );
}

/** A From - To range picked on one calendar: the first tap starts it, the second ends it. */
export function DateRangeField({ range, onChange, onClear, id, min, max, disabled, placeholder = 'Pick dates', className = '', ...rest }: FieldBase & {
  range: DayRange | null;
  onChange: (range: DayRange) => void;
  onClear?: () => void;
}) {
  const { open, setOpen, button, close, openCount } = useOpen();
  const set = range && range.from && range.to ? range : null;
  return (
    <span className="date-field">
      <button
        ref={button}
        id={id}
        type="button"
        className={`date-field-button is-range ${set ? '' : 'is-empty'} ${className}`.trim()}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest['aria-label'] ? `${rest['aria-label']}: ${set ? formatRange(set) : 'not set'}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="date-field-text">{set ? formatRange(set) : placeholder}</span>
        <CalendarIcon />
      </button>
      <AnimatePresence>
        {open && (
          <Popup key={openCount} anchor={button.current} title={rest['aria-label'] || 'Choose dates'} onClose={close} width={304}>
            <Calendar mode="range" range={set} min={min} max={max} onRange={onChange} onClear={onClear} onDone={close} />
          </Popup>
        )}
      </AnimatePresence>
    </span>
  );
}
