import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useNotification, type InboxNotification } from '../contexts/NotificationContext';
import { prefersReducedMotion } from '../lib/motion';
import { openRating } from '../services/rating';
import { playSoundPreview, setSoundEnabled, soundEnabled } from '../services/sfx';

const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/*
 * Genie effect for the desktop popover: the panel pours out of the bell (TopNav's [data-notif-anchor])
 * and is sucked back into it on close. A clip-path funnel, pinched at the bell, widens from the bottom
 * up while the panel stretches down from the bell. Done with the Web Animations API, because the
 * funnel depends on where the bell sits relative to the panel, which is only known once it is mounted.
 */
const GENIE_OPEN_MS = 460;
const GENIE_CLOSE_MS = 340;
const GENIE_ROWS = 6; // points down each side of the funnel; more rows, smoother curve

function genieKeyframes(panel: HTMLElement): Keyframe[] {
  const box = panel.getBoundingClientRect();
  const w = box.width;
  const h = box.height;
  const anchor = document.querySelector<HTMLElement>('[data-notif-anchor]')?.getBoundingClientRect();
  // Bell centre across the panel, and its bottom edge above the panel's top (negative).
  const bx = anchor ? Math.min(Math.max(anchor.left + anchor.width / 2 - box.left, 0), w) : w - 24;
  const by = anchor ? anchor.bottom - box.top : -30;
  const neck = Math.min(anchor?.width ?? 40, w) / 2; // half-width of the funnel at the bell

  // A funnel whose half-width at row f (0 top .. 1 bottom) is spread(f), left side down, right side up.
  const funnel = (spread: (f: number) => number) => {
    const rows = Array.from({ length: GENIE_ROWS + 1 }, (_, i) => i / GENIE_ROWS);
    const side = (f: number, dir: -1 | 1) => {
      const t = spread(f);
      const x = dir < 0 ? bx - (bx - 0) * t - neck * (1 - t) : bx + (w - bx) * t + neck * (1 - t);
      return `${x.toFixed(1)}px ${(f * h).toFixed(1)}px`;
    };
    const left = rows.map((f) => side(f, -1));
    const right = [...rows].reverse().map((f) => side(f, 1));
    return `polygon(${[...left, ...right].join(', ')})`;
  };

  const origin = `${bx.toFixed(1)}px 0px`;
  return [
    { offset: 0, opacity: 0, transformOrigin: origin, transform: `translateY(${by.toFixed(1)}px) scale(0.12, 0.04)`, clipPath: funnel(() => 0) },
    // The bottom has opened out while the top is still pinched at the bell.
    { offset: 0.5, opacity: 1, transformOrigin: origin, transform: `translateY(${(by * 0.15).toFixed(1)}px) scale(1, 0.72)`, clipPath: funnel((f) => f * f * 0.9) },
    { offset: 1, opacity: 1, transformOrigin: origin, transform: 'translateY(0px) scale(1, 1)', clipPath: funnel(() => 1) },
  ];
}

/** Turns every sound in the app on or off (notifications and page transitions share the setting). */
function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  const toggle = () => {
    const next = !on;
    setSoundEnabled(next);
    setOn(next);
    if (next) playSoundPreview();
  };
  return (
    <button
      type="button"
      className={`notif-sound ${on ? '' : 'off'}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Sounds on. Turn off' : 'Sounds off. Turn on'}
      title={on ? 'Sounds on' : 'Sounds off'}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        {on ? (
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14" />
        ) : (
          <path d="M23 9l-6 6 M17 9l6 6" />
        )}
      </svg>
    </button>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  // 'popover' drops from the top bar's bell on desktop; 'sheet' rises from the bottom on phones.
  variant: 'popover' | 'sheet';
}

export default function NotificationPanel({ open, onClose, variant }: NotificationPanelProps) {
  const { inbox, unread, markRead, markAllRead, clearOne, clearAll } = useNotification();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const isSheet = variant === 'sheet';
  // The popover stays mounted while its genie closes (closing), then unmounts. Set during render
  // so the panel mounts in the same commit `open` flips, and its genie and focus run at once.
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open && !isSheet);
  }
  const popoverMounted = !isSheet && (open || closing);
  const genieRef = useRef<Animation | null>(null);

  // Before paint, so the full panel never flashes up ahead of the genie.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!popoverMounted || !panel) return;
    genieRef.current?.cancel();
    const reduce = prefersReducedMotion();
    if (open) {
      genieRef.current = reduce
        ? panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
        : panel.animate(genieKeyframes(panel), { duration: GENIE_OPEN_MS, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' });
      return;
    }
    const anim = reduce
      ? panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
      : panel.animate(genieKeyframes(panel), { duration: GENIE_CLOSE_MS, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)', direction: 'reverse', fill: 'forwards' });
    genieRef.current = anim;
    anim.onfinish = () => {
      if (genieRef.current === anim) setClosing(false);
    };
  }, [open, popoverMounted]);

  useEffect(() => () => genieRef.current?.cancel(), []);

  // "Clear all" asks for a second tap, since cleared notifications can't be brought back.
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open || !confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [open, confirmClear]);

  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  const onClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearAll();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const openItem = (n: InboxNotification) => {
    markRead(n.id);
    onClose();
    if (n.link) navigate(n.link);
  };

  const rateItem = (n: InboxNotification) => {
    if (!n.rate || !n.request_code) return;
    markRead(n.id);
    openRating(n.rate.request_id, n.request_code, n.rate.type);
  };

  const panelContent = (
    <>
      <header className="notif-head">
        <h2>Notifications</h2>
        <div className="notif-head-actions">
          {inbox.length > 0 && unread > 0 && (
            <button type="button" className="notif-mark-all" onClick={markAllRead}>
              Mark all as read
            </button>
          )}
          {inbox.length > 0 && (
            <button type="button" className={`notif-mark-all notif-clear-all ${confirmClear ? 'confirm' : ''}`} onClick={onClearAll}>
              {confirmClear ? 'Tap again to clear' : 'Clear all'}
            </button>
          )}
          <SoundToggle />
        </div>
      </header>

      {inbox.length === 0 ? (
        <div className="notif-empty">
          <BellIcon />
          <p>You're all caught up.</p>
          <span>Updates on your requests will show up here.</span>
        </div>
      ) : (
        <ul className="notif-list">
          {inbox.map((n) => (
            <li key={n.id} className={`notif-row ${n.read ? '' : 'unread'}`}>
              <button type="button" className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <span className={`notif-dot ${n.level}`} aria-hidden="true" />
                <span className="notif-body">
                  <span className="notif-title">
                    {n.title}
                    {!n.read && <span className="sr-only"> (unread)</span>}
                  </span>
                  <span className="notif-msg">{n.message}</span>
                  <time className="notif-time" dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                </span>
              </button>
              {n.rate && n.request_code && (
                <button type="button" className="hbtn hbtn-rate notif-rate" onClick={() => rateItem(n)}>
                  Rate
                </button>
              )}
              <button
                type="button"
                className="notif-clear"
                onClick={() => clearOne(n.id)}
                aria-label={`Clear notification: ${n.title}`}
                title="Clear"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const panelProps = {
    ref: panelRef,
    tabIndex: -1,
    role: 'dialog',
    'aria-label': 'Notifications',
    className: `notif-panel notif-panel--${variant}`,
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="notif-backdrop"
            className={`notif-backdrop ${isSheet ? 'dim' : ''}`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          />
        )}
        {open && isSheet && (
          <motion.div
            key="notif-sheet"
            {...panelProps}
            initial={{ transform: 'translateY(100%)' }}
            animate={{ transform: 'translateY(0%)', transition: { duration: 0.32, ease: EASE_DRAWER } }}
            exit={{ transform: 'translateY(100%)', transition: { duration: 0.22, ease: EASE_DRAWER } }}
          >
            {panelContent}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Closing: ignore clicks so a stray one can't land on a row that is being sucked away. */}
      {!isSheet && popoverMounted && (
        <div {...panelProps} style={open ? undefined : { pointerEvents: 'none' }}>
          {panelContent}
        </div>
      )}
    </>
  );
}
