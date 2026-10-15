import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AnimatePresence } from 'framer-motion';
import Popup from './Popup';

// Dropdowns in ITRS's own style. Used exactly like <select> (same props, same <option> children,
// same onChange event), so forms, validation and every page's handlers keep working: the real
// select stays in place as the field, and only its list is replaced, since the browser's own list
// can't be styled and differs on every phone. On desktop the list drops from the field; on phones
// it rises as a bottom sheet. Long lists get a search box.

interface Option {
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * The field's label, for the phone sheet's title: its <label>, a label wrapping it (its own text
 * only, not the options'), or the label in the same form group. Without the "*" of required fields.
 */
function labelOf(el: HTMLSelectElement): string {
  const label = el.labels?.[0] ?? el.closest('label') ?? el.closest('.form-group')?.querySelector('label') ?? null;
  if (!label) return '';
  const own = Array.from(label.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ');
  return (own.trim() || label.textContent || '').replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Lists longer than this get a search box at the top. */
const SEARCH_FROM = 9;

type Props = SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode };

function Select({ children, onKeyDown, ...props }: Props) {
  const select = useRef<HTMLSelectElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [title, setTitle] = useState('');
  // Each open is a new list: one reopened while the last still drains gets its own (and the
  // keyboard), rather than taking over the closing one.
  const [openCount, setOpenCount] = useState(0);

  // The options are read from the select itself when the list opens, so they always match it.
  const openList = () => {
    const el = select.current;
    if (!el || el.disabled) return;
    setOptions(Array.from(el.options).map((o) => ({ value: o.value, label: o.text, disabled: o.disabled })));
    setTitle(props['aria-label'] || labelOf(el) || 'Choose');
    setOpenCount((n) => n + 1);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    select.current?.focus({ preventScroll: true });
  };

  // Picking sets the select and fires a real change event, which React hands to onChange as usual.
  const choose = (value: string) => {
    const el = select.current;
    if (el && el.value !== value) {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  };

  const onSelectKey = (e: KeyboardEvent<HTMLSelectElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  };

  return (
    <span className="select-wrap" ref={wrap}>
      <select ref={select} {...props} onKeyDown={onSelectKey} onMouseDown={(e) => e.preventDefault()}>
        {children}
      </select>
      {/* Takes the click in place of the select, so the browser's own list never opens. */}
      <button
        type="button"
        className="select-hit"
        tabIndex={-1}
        aria-hidden="true"
        disabled={props.disabled}
        onClick={() => {
          if (open) return close();
          select.current?.focus({ preventScroll: true });
          openList();
        }}
      />
      <AnimatePresence>
        {open && (
          <Popup key={openCount} anchor={wrap.current} title={title} onClose={close} width={200} matchWidth className="popup-list">
            <OptionList options={options} value={select.current?.value ?? ''} title={title} onChoose={choose} onClose={close} />
          </Popup>
        )}
      </AnimatePresence>
    </span>
  );
}

function OptionList({ options, value, title, onChoose, onClose }: {
  options: Option[];
  value: string;
  title: string;
  onChoose: (value: string) => void;
  onClose: () => void;
}) {
  const listId = useId();
  const searchable = options.length >= SEARCH_FROM;
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const firstEnabled = (list: Option[]) => Math.max(0, list.findIndex((o) => !o.disabled));
  const [active, setActive] = useState(() => {
    const i = options.findIndex((o) => o.value === value);
    return i >= 0 ? i : firstEnabled(options);
  });
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: '', at: 0 });


  // A frame later: the popover is hidden for its first frame while it finds its place.
  useEffect(() => {
    const id = requestAnimationFrame(() => (searchable ? search.current : list.current)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [searchable]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const move = (from: number, step: number) => {
    for (let i = from + step; i >= 0 && i < shown.length; i += step) if (!shown[i].disabled) return i;
    return from;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => move(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => move(a, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(move(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(move(shown.length, -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active] && !shown[active].disabled) onChoose(shown[active].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Tab') onClose();
    else if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing jumps to the option starting with what was typed, as the native list does.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className="opt" onKeyDown={onKey}>
      {searchable && (
        <input
          ref={search}
          type="search"
          className="opt-search"
          placeholder="Search"
          aria-label={`Search ${title.toLowerCase()}`}
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => {
            // Searching moves the highlight to the first match.
            const next = e.target.value;
            const nq = next.trim().toLowerCase();
            setQuery(next);
            setActive(firstEnabled(nq ? options.filter((o) => o.label.toLowerCase().includes(nq)) : options));
          }}
        />
      )}
      <ul
        ref={list}
        id={listId}
        className="opt-list"
        role="listbox"
        aria-label={title}
        tabIndex={searchable ? -1 : 0}
        aria-activedescendant={!searchable && shown[active] ? `${listId}-${active}` : undefined}
      >
        {shown.map((o, i) => (
          <li
            key={`${o.value}-${i}`}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={o.value === value}
            aria-disabled={o.disabled || undefined}
            className={`opt-item ${i === active ? 'is-active' : ''} ${o.value === value ? 'is-selected' : ''} ${o.disabled ? 'is-disabled' : ''} ${o.value === '' ? 'is-placeholder' : ''}`}
            onMouseMove={() => !o.disabled && i !== active && setActive(i)}
            onClick={() => !o.disabled && onChoose(o.value)}
          >
            <span className="opt-label">{o.label}</span>
            {o.value === value && (
              <svg className="opt-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="opt-empty" role="presentation">No matches</li>}
      </ul>
    </div>
  );
}

export default Select;
