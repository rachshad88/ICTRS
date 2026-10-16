import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { AnimatePresence } from 'framer-motion';
import Popup from './Popup';
import { useOpen } from './DateField';

// Time fields in ITRS's own style, in place of <input type="time"> (whose picker can't be styled
// and differs on every browser). Opens like the date fields: a popover from the field on desktop,
// a bottom sheet on phones, with hour, minute and AM/PM columns. Values stay HH:MM (24-hour)
// strings, as the native input gave.

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_STEP = 5;
const MERIDIEMS = ['AM', 'PM'] as const;
type Meridiem = (typeof MERIDIEMS)[number];

interface Parts {
  h: number;
  m: number;
  ap: Meridiem;
}

const parse = (v: string): Parts | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!match) return null;
  const h24 = Number(match[1]);
  return { h: h24 % 12 || 12, m: Number(match[2]), ap: h24 < 12 ? 'AM' : 'PM' };
};
const compose = ({ h, m, ap }: Parts) =>
  `${String((h % 12) + (ap === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const pad = (n: number) => String(n).padStart(2, '0');
export const formatTime = (v: string) => {
  const p = parse(v);
  return p ? `${p.h}:${pad(p.m)} ${p.ap}` : '';
};

/** What an empty field starts from: the first column picked fills the others from here. */
const START: Parts = { h: 8, m: 0, ap: 'AM' };

const ClockIcon = () => (
  <svg className="date-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export function TimeField({ value, onChange, required, name, id, disabled, placeholder = 'Pick a time', className = '', ...rest }: {
  value: string;
  onChange: (time: string) => void;
  required?: boolean;
  name?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
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
        aria-label={rest['aria-label'] ? `${rest['aria-label']}: ${value ? formatTime(value) : 'not set'}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="date-field-text">{value ? formatTime(value) : placeholder}</span>
        <ClockIcon />
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
          <Popup key={openCount} anchor={button.current} title={rest['aria-label'] || 'Choose a time'} onClose={close} width={264}>
            <TimePicker value={value} onChange={onChange} onDone={close} />
          </Popup>
        )}
      </AnimatePresence>
    </span>
  );
}

function TimePicker({ value, onChange, onDone }: { value: string; onChange: (time: string) => void; onDone: () => void }) {
  const parts = parse(value);
  const shown = parts ?? START;
  // Five-minute steps, plus the field's own minute when it is between them (e.g. from "Now").
  const minutes = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
  if (parts && !minutes.includes(parts.m)) {
    minutes.push(parts.m);
    minutes.sort((a, b) => a - b);
  }

  const set = (next: Partial<Parts>) => {
    const base = parts ?? { ...START, ...(next.h ? { ap: next.h >= 7 && next.h <= 11 ? 'AM' : 'PM' } as const : {}) };
    onChange(compose({ ...base, ...next }));
  };

  const cols = useRef<Array<HTMLDivElement | null>>([]);
  // Each column scrolls its choice to the middle, so the panel opens on the time already set.
  const centre = (col: HTMLDivElement | null, smooth = false) => {
    const item = col?.querySelector<HTMLElement>('.is-selected') ?? col?.querySelector<HTMLElement>('[data-start]');
    if (!col || !item) return;
    col.scrollTo({ top: item.offsetTop - (col.clientHeight - item.offsetHeight) / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  useLayoutEffect(() => {
    cols.current.forEach((c) => centre(c));
    // A frame later: the popover is hidden for its first frame while it finds its place.
    const id = requestAnimationFrame(() => {
      const first = cols.current[0];
      (first?.querySelector<HTMLElement>('[tabindex="0"]'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Up and down step through a column and pick as they go, like a spinner; left and right move
  // between columns.
  const onColKey = (e: KeyboardEvent, col: number, items: number[] | readonly string[], pick: (i: number) => void, at: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      pick(i);
      requestAnimationFrame(() => {
        const c = cols.current[col];
        c?.querySelector<HTMLElement>('.is-selected')?.focus({ preventScroll: true });
        centre(c, true);
      });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = cols.current[col + (e.key === 'ArrowRight' ? 1 : -1)];
      next?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    }
  };

  const column = (col: number, label: string, items: Array<number | string>, text: (v: number | string) => string, selected: number | string | null, start: number | string, pick: (v: number | string) => void) => {
    const at = selected === null ? items.indexOf(start) : items.indexOf(selected);
    return (
      <div className="time-group">
        <span className="time-label">{label}</span>
        <div
          ref={(n) => { cols.current[col] = n; }}
          className="time-col"
          role="listbox"
          aria-label={label}
          onKeyDown={(e) => onColKey(e, col, items as number[], (i) => pick(items[i]), at)}
        >
          {items.map((v) => (
            <button
              key={v}
              type="button"
              role="option"
              className={`time-opt ${v === selected ? 'is-selected' : ''}`}
              aria-selected={v === selected}
              data-start={v === start ? '' : undefined}
              tabIndex={items[at] === v ? 0 : -1}
              onClick={() => pick(v)}
            >
              {text(v)}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const now = () => {
    const d = new Date();
    onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  // Esc closes; Enter on a choice picks it and closes.
  const onKey = (e: KeyboardEvent) => {
    const opt = (e.target as HTMLElement).closest('.time-opt');
    if (e.key === 'Escape' || (e.key === 'Enter' && opt)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') (opt as HTMLButtonElement).click();
      onDone();
    }
  };

  return (
    <div className="time" onKeyDown={onKey}>
      <div className={`time-head ${parts ? '' : 'is-empty'}`} aria-live="polite">
        {parts ? formatTime(value) : 'No time set'}
      </div>
      <div className="time-cols">
        {column(0, 'Hour', HOURS, String, parts?.h ?? null, shown.h, (v) => set({ h: v as number }))}
        {column(1, 'Min', minutes, (v) => pad(v as number), parts?.m ?? null, shown.m, (v) => set({ m: v as number }))}
        {column(2, 'AM/PM', [...MERIDIEMS], String, parts?.ap ?? null, shown.ap, (v) => set({ ap: v as Meridiem }))}
      </div>
      <div className="cal-foot">
        <span className="cal-foot-actions">
          <button type="button" className="cal-link" onClick={now}>Now</button>
          <button type="button" className="cal-link time-done" onClick={onDone}>Done</button>
        </span>
      </div>
    </div>
  );
}

export default TimeField;
