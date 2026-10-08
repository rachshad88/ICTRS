import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';

// The office field on the sign-up page: a searchable list in the page's ticket style, in place of a
// native <select> (whose open list can't be styled and differs on every phone). Offices are grouped
// by their prefix, so "MMO - Tourism Section" shows as "Tourism Section" under "Mayor's Office".
// A hidden required input keeps the browser's own "please fill in this field" check on submit.

interface Props {
  id: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
}

const GROUPS: { prefix: string; label: string }[] = [
  { prefix: 'MMO - ', label: "Mayor's Office" },
  { prefix: 'SEEDO - ', label: 'SEEDO' },
];
const OTHER = 'Offices and agencies';

function groupOf(office: string) {
  const g = GROUPS.find((x) => office.startsWith(x.prefix));
  return g ? { label: g.label, name: office.slice(g.prefix.length) } : { label: OTHER, name: office };
}

/** The office name with the part matching the search in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

export default function OfficePicker({ id, value, options, onChange, placeholder = 'Select your office' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const validityRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Matching offices in display order (grouped), each with its group and short name.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = options.map((office) => ({ office, ...groupOf(office) }));
    const order = [OTHER, ...GROUPS.map((g) => g.label)];
    return all
      .filter((o) => !q || o.office.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  }, [options, query]);

  useEffect(() => {
    validityRef.current?.setCustomValidity(value ? '' : 'Select your office');
  }, [value]);

  // On open: start on the chosen office and put the cursor in the search box.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(Math.max(0, items.findIndex((o) => o.office === value)));
    requestAnimationFrame(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Click or tap outside closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // Keep the highlighted option in view while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (office: string) => {
    onChange(office);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) choose(items[active].office);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const current = value ? groupOf(value) : null;

  return (
    <div className={`office-picker ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={`office-picker-button ${value ? '' : 'is-empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {current ? (
          <span className="office-picker-value">
            {current.label !== OTHER && <span className="office-picker-group">{current.label}</span>}
            <span className="office-picker-name">{current.name}</span>
          </span>
        ) : (
          <span className="office-picker-placeholder">{placeholder}</span>
        )}
        <svg className="office-picker-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Carries the required check for the form; the browser points its message at it on submit. */}
      <input
        ref={validityRef}
        className="office-picker-validity"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={() => {}}
        onFocus={() => buttonRef.current?.focus()}
        required
      />

      <AnimatePresence>
        {open && (
          <motion.div
            className="office-picker-panel"
            initial={{ opacity: 0, y: -6, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.98, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            style={{ transformOrigin: '50% 0%' }}
          >
            <div className="office-picker-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label="Search offices"
                aria-controls={listId}
                aria-expanded="true"
                aria-autocomplete="list"
                aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
                placeholder="Search offices"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="office-picker-count">{items.length}</span>
            </div>

            <ul className="office-picker-list" id={listId} role="listbox" aria-label="Offices" ref={listRef}>
              {items.length === 0 && <li className="office-picker-empty">No office matches “{query}”</li>}
              {items.map((o, i) => {
                const first = i === 0 || items[i - 1].label !== o.label;
                return (
                  <li key={o.office} role="presentation">
                    {first && <span className="office-picker-heading" aria-hidden="true">{o.label}</span>}
                    <div
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={o.office === value}
                      className={`office-picker-option ${i === active ? 'is-active' : ''} ${o.office === value ? 'is-selected' : ''}`}
                      onPointerMove={() => setActive(i)}
                      onClick={() => choose(o.office)}
                    >
                      <span><Highlight text={o.name} query={query.trim()} /></span>
                      {o.office === value && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
