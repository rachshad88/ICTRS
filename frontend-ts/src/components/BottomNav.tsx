import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useAnimate, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useLogoutTransition } from './LogoutTransition';
import { useNavItems, useNavBadge, NavIcon, PROFILE_ICON, LOGOUT_ICON, type NavEntry, type NavLink } from './navItems';

/** Tabs shown in the bar itself, before More. */
const BAR_SLOTS = 4;

/** Low damping: things overshoot and settle like jelly. */
const JELLY = { type: 'spring', stiffness: 420, damping: 22, mass: 0.9 } as const;
const SHEET_SPRING = { type: 'spring', stiffness: 360, damping: 30 } as const;
const STILL = { duration: 0 } as const;

const POPOVER_W = 212;

/**
 * Phones with little memory or few cores struggle to re-blur the page every frame, so they get a
 * lighter glass (.glass-lite in bottom-nav.css). deviceMemory is reported by Chrome only.
 */
const LITE_GLASS =
  (navigator.hardwareConcurrency ?? 8) <= 4 ||
  ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** A light tick on phones that support it, so a tap feels pressed. */
const tick = () => navigator.vibrate?.(8);

/** One bar slot: a page, or a group of pages (a menu section) that opens a choice bubble above it. */
interface Tab {
  key: string;
  label: string;
  icon: string;
  links: NavLink[];
}

/**
 * Menus with several titled sections (a client's IT / Multimedia / Digital / Print) get one tab
 * per section; the rest get one tab per page. Profile fills a spare slot.
 */
function buildTabs(items: NavEntry[], profile: NavLink): Tab[] {
  const groups: Array<{ head?: NavEntry; links: NavLink[] }> = [];
  for (const item of items) {
    if (item.section !== undefined) groups.push({ head: item, links: [] });
    else if (item.to) {
      if (!groups.length) groups.push({ links: [] });
      groups[groups.length - 1].links.push(item as NavLink);
    }
  }
  const titled = groups.filter((g) => g.head?.section && g.head.icon && g.links.length);
  const pageTab = (l: NavLink): Tab => ({ key: l.to, label: l.short ?? l.label, icon: l.icon, links: [l] });

  let tabs: Tab[];
  if (titled.length >= 2) {
    tabs = groups.flatMap((g) =>
      g.head?.section && g.head.icon && g.links.length > 1
        ? [{ key: g.head.section, label: g.head.short ?? g.head.section, icon: g.head.icon, links: g.links }]
        : g.links.map(pageTab),
    );
  } else {
    tabs = groups.flatMap((g) => g.links).map(pageTab);
  }
  tabs = tabs.slice(0, BAR_SLOTS);
  if (tabs.length < BAR_SLOTS) tabs.push(pageTab(profile));
  return tabs;
}

/**
 * Mobile navigation: a floating liquid-glass bar at the bottom of the screen. A tab is a page, or a
 * service whose pages (new request, history) pop up in a bubble above it. More raises a sheet with
 * the whole menu, Profile and Logout. The bar slides away while scrolling down.
 */
function BottomNav() {
  const { user } = useAuth();
  const { signOut } = useLogoutTransition();
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  const items = useNavItems();
  const badgeFor = useNavBadge();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const hidden = useHideOnScroll(moreOpen || openGroup !== null);
  // The sheet is dragged by its handle and header only, so its list can still scroll.
  const dragControls = useDragControls();
  const startDrag = (e: React.PointerEvent) => dragControls.start(e);
  const navRef = useRef<HTMLElement>(null);
  const groupButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  const profile: NavLink = { to: '/profile', icon: PROFILE_ICON, label: 'Profile' };
  const tabs = buildTabs(items, profile);
  const links = items.filter((i): i is NavLink => !!i.to);
  const inBar = new Set(tabs.flatMap((t) => t.links.map((l) => l.to)));
  const activeTab = tabs.find((t) => t.links.some((l) => l.to === pathname));
  const tabBadge = (t: Tab) => t.links.reduce((n, l) => n + (badgeFor(l.to) ?? 0), 0);
  // Work waiting on pages that only the sheet shows, so More can hint at it.
  const moreBadge = links.filter((l) => !inBar.has(l.to)).reduce((n, l) => n + (badgeFor(l.to) ?? 0), 0);

  useEffect(() => {
    setMoreOpen(false);
    setOpenGroup(null);
  }, [pathname]);

  useEffect(() => {
    if (!LITE_GLASS) return;
    document.documentElement.classList.add('glass-lite');
    return () => document.documentElement.classList.remove('glass-lite');
  }, []);

  // Escape or a tap anywhere else closes the choice bubble.
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenGroup(null);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // The glass lens sits on the open bubble's tab first, then the More sheet, then the current page.
  const lensOn = (key: string) =>
    openGroup ? key === openGroup : moreOpen ? key === '__more' : key === (activeTab?.key ?? '__more');

  const lens = (
    <motion.span layoutId="bottom-nav-lens" className="bottom-nav-lens" transition={reduce ? STILL : JELLY}>
      <span className="bottom-nav-lens-shine" />
    </motion.span>
  );

  return createPortal(
    <>
      <nav ref={navRef} className={`bottom-nav ${hidden ? 'is-hidden' : ''}`} aria-label="Main">
        <span className="bottom-nav-glass" aria-hidden="true" />

        {tabs.map((t) => {
          const isGroup = t.links.length > 1;
          const current = activeTab?.key === t.key;
          const badge = tabBadge(t);
          const content = (
            <>
              <JellyIcon on={lensOn(t.key)} lens={lensOn(t.key) ? lens : null} reduce={!!reduce}>
                <NavIcon d={t.icon} size={22} />
                <Badge count={badge || null} />
              </JellyIcon>
              <span className="bottom-nav-label">{t.label}</span>
              {current && <motion.span layoutId="bottom-nav-dot" className="bottom-nav-dot" transition={reduce ? STILL : JELLY} />}
            </>
          );
          const cls = `bottom-nav-item ${current ? 'current' : ''} ${lensOn(t.key) ? 'lensed' : ''}`;

          if (!isGroup) {
            return (
              <Link key={t.key} to={t.links[0].to} className={cls} aria-current={current ? 'page' : undefined} aria-label={t.links[0].label} onClick={tick}>
                {content}
              </Link>
            );
          }
          return (
            <div key={t.key} className="bottom-nav-slot">
              <button
                ref={(el) => { groupButtons.current[t.key] = el; }}
                type="button"
                className={cls}
                aria-expanded={openGroup === t.key}
                aria-haspopup="menu"
                aria-label={t.label}
                onClick={() => {
                  tick();
                  setMoreOpen(false);
                  setOpenGroup((g) => (g === t.key ? null : t.key));
                }}
              >
                {content}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className={`bottom-nav-item bottom-nav-more ${moreOpen ? 'open' : ''} ${!activeTab ? 'current' : ''} ${lensOn('__more') ? 'lensed' : ''}`}
          onClick={() => {
            tick();
            setOpenGroup(null);
            setMoreOpen((o) => !o);
          }}
          aria-expanded={moreOpen}
          aria-controls="bottom-nav-sheet"
          aria-label={moreOpen ? 'Close menu' : 'More'}
        >
          <JellyIcon on={lensOn('__more')} lens={lensOn('__more') ? lens : null} reduce={!!reduce}>
            <span className="more-glyph" aria-hidden="true"><i /><i /><i /><i /></span>
            {!moreOpen && <Badge count={moreBadge || null} />}
          </JellyIcon>
          <span className="bottom-nav-label">{moreOpen ? 'Close' : 'More'}</span>
          {!activeTab && !moreOpen && <motion.span layoutId="bottom-nav-dot" className="bottom-nav-dot" transition={reduce ? STILL : JELLY} />}
        </button>

        <AnimatePresence>
          {openGroup && (
            <ChoiceBubble
              key={openGroup}
              tab={tabs.find((t) => t.key === openGroup)!}
              navRef={navRef}
              anchor={groupButtons.current[openGroup] ?? null}
              pathname={pathname}
              badgeFor={badgeFor}
              reduce={!!reduce}
            />
          )}
        </AnimatePresence>
      </nav>

      <AnimatePresence>
        {openGroup && (
          <motion.div
            key="bubble-veil"
            className="bottom-nav-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              key="backdrop"
              className="bottom-sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              key="sheet"
              id="bottom-nav-sheet"
              className="bottom-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={reduce ? STILL : SHEET_SPRING}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.6 }}
              onDragEnd={(_: unknown, info: PanInfo) => {
                if (info.offset.y > 90 || info.velocity.y > 500) setMoreOpen(false);
              }}
            >
              <div className="bottom-sheet-grip" onPointerDown={startDrag}>
                <div className="bottom-sheet-handle" aria-hidden="true" />
              </div>

              {user && (
                <div className="bottom-sheet-user" onPointerDown={startDrag}>
                  <span className="bottom-sheet-avatar" aria-hidden="true">
                    {(user.first_name[0] ?? '') + (user.last_name[0] ?? '')}
                  </span>
                  <span className="bottom-sheet-user-text">
                    <strong>{user.first_name} {user.last_name}</strong>
                    <span>{user.office || 'IT Request System'}</span>
                  </span>
                </div>
              )}

              <div className="bottom-sheet-body">
                {items.map((item, i) => {
                  if (item.section !== undefined) {
                    return item.section
                      ? <SheetRow key={i} className="bottom-sheet-section">{item.section}</SheetRow>
                      : <SheetRow key={i} className="bottom-sheet-divider" />;
                  }
                  return <SheetLink key={item.to} link={item as NavLink} active={pathname === item.to} badge={badgeFor(item.to!)} />;
                })}
                <SheetRow className="bottom-sheet-divider" />
                <SheetLink link={profile} active={pathname === '/profile'} badge={null} />
                <SheetRow>
                  <button type="button" className="bottom-sheet-link logout" onClick={() => { setMoreOpen(false); signOut(); }}>
                    <span className="bottom-sheet-link-icon"><NavIcon d={LOGOUT_ICON} /></span>
                    <span>Logout</span>
                  </button>
                </SheetRow>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

/**
 * A tab's icon: squashes on press, and wobbles like jelly when the glass lens lands on it.
 * The lens is passed in so it renders behind the icon inside this box.
 */
function JellyIcon({ on, lens, reduce, children }: { on: boolean; lens: React.ReactNode; reduce: boolean; children: React.ReactNode }) {
  const [glyph, animate] = useAnimate<HTMLSpanElement>();
  // Runs once each time the lens arrives, not on every re-render.
  useEffect(() => {
    if (!on || reduce || !glyph.current) return;
    animate(
      glyph.current,
      { scaleX: [1, 1.24, 0.86, 1.08, 0.97, 1], scaleY: [1, 0.78, 1.14, 0.95, 1.02, 1], y: [0, 2, -4, 0, 0, 0] },
      { duration: 0.65, ease: 'easeOut' },
    );
  }, [on, reduce, animate, glyph]);
  return (
    <motion.span className="bottom-nav-icon" whileTap={reduce ? undefined : { scaleX: 1.18, scaleY: 0.84 }} transition={JELLY}>
      {lens}
      <span ref={glyph} className="bottom-nav-glyph">{children}</span>
    </motion.span>
  );
}

/** The glass bubble of a service's pages, rising out of its tab with a jelly overshoot. */
function ChoiceBubble({ tab, navRef, anchor, pathname, badgeFor, reduce }: {
  tab: Tab;
  navRef: React.RefObject<HTMLElement>;
  anchor: HTMLElement | null;
  pathname: string;
  badgeFor: (path: string) => number | null;
  reduce: boolean;
}) {
  const [pos, setPos] = useState<{ left: number; tail: number } | null>(null);

  // Centre over the tab, kept inside the bar; the tail still points at the tab.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !anchor) return;
    const navBox = nav.getBoundingClientRect();
    const btnBox = anchor.getBoundingClientRect();
    const centre = btnBox.left + btnBox.width / 2 - navBox.left;
    const left = Math.min(Math.max(centre - POPOVER_W / 2, 0), navBox.width - POPOVER_W);
    setPos({ left, tail: centre - left });
  }, [anchor, navRef]);

  if (!pos) return null;
  return (
    <motion.div
      className="nav-bubble"
      role="menu"
      aria-label={tab.label}
      style={{ left: pos.left, width: POPOVER_W, transformOrigin: `${pos.tail}px 100%` }}
      // Grows and shrinks but never fades: while an element is partly transparent, browsers stop
      // the glass inside it from blurring the page, so a fade would show plain see-through until it ends.
      initial={reduce ? false : { scale: 0, y: 24 }}
      animate={{ scale: 1, y: 0 }}
      exit={reduce ? { scale: 0, transition: STILL } : { scale: 0, y: 16, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
      transition={reduce ? STILL : { type: 'spring', stiffness: 520, damping: 20 }}
    >
      <span className="nav-bubble-glass" aria-hidden="true" />
      <span className="nav-bubble-tail" style={{ left: pos.tail }} aria-hidden="true" />
      {/* The tab is keyed by its section's full name: IT Services, Multimedia, ... */}
      <span className="nav-bubble-title">{tab.key}</span>
      {tab.links.map((l, i) => {
        const active = l.to === pathname;
        const badge = badgeFor(l.to);
        return (
            <Link
              key={l.to}
              to={l.to}
              style={{ animationDelay: `${60 + i * 50}ms` }}
              role="menuitem"
              className={`nav-bubble-link ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={tick}
            >
              <span className="nav-bubble-icon"><NavIcon d={l.icon} size={18} /></span>
              <span className="nav-bubble-text">{l.short ?? l.label}</span>
              {badge !== null && badge > 0 && <span className="nav-bubble-badge">{badge > 99 ? '99+' : badge}</span>}
            </Link>
        );
      })}
    </motion.div>
  );
}

function SheetRow({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}

function SheetLink({ link, active, badge }: { link: NavLink; active: boolean; badge: number | null }) {
  return (
    <SheetRow>
      <Link to={link.to} className={`bottom-sheet-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={tick}>
        <span className="bottom-sheet-link-icon"><NavIcon d={link.icon} /></span>
        <span>{link.label}</span>
        {badge !== null && badge > 0 && <span className="bottom-sheet-badge">{badge > 99 ? '99+' : badge}</span>}
      </Link>
    </SheetRow>
  );
}

function Badge({ count }: { count: number | null }) {
  return (
    <AnimatePresence>
      {count !== null && count > 0 && (
        <motion.span
          key={count}
          className="bottom-nav-badge"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ type: 'spring', stiffness: 700, damping: 14 }}
        >
          {count > 99 ? '99+' : count}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** True while the reader is scrolling down the page; false near the top or when scrolling back up. */
function useHideOnScroll(paused: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    if (paused) {
      setHidden(false);
      return;
    }
    last.current = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 4;
        if (y < 80 || atBottom) {
          setHidden(false);
          last.current = y;
          return;
        }
        // Small moves accumulate until they add up to a real scroll in one direction.
        const delta = y - last.current;
        if (Math.abs(delta) < 12) return;
        setHidden(delta > 0);
        last.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [paused]);
  return hidden;
}

export default BottomNav;
