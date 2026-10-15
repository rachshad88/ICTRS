import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, animate, motion, useAnimate, useDragControls, useMotionValue, usePresence, useReducedMotion, type PanInfo } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useLogoutTransition } from './LogoutTransition';
import { LITE_DEVICE } from '../lib/motion';
import { genieFrame, genieFrameBelow, genieWarp, toClipPath } from '../lib/genie';
import { useNavItems, useNavBadge, NavIcon, PROFILE_ICON, LOGOUT_ICON, type NavEntry, type NavLink } from './navItems';

/** Warped copies of the choice bubbles' content (ChoiceBubble), kept so a tab's is built only once. */
const warpCache = new Map<string, { html: string; bodyW: number; bodyH: number; layer: HTMLElement; slices: HTMLElement[] }>();

/** When the last genie began. Taps coming faster than a genie plays skip its warp, to stay smooth. */
let lastGenieStart = 0;

/** Tabs shown in the bar itself, before More. */
const BAR_SLOTS = 4;

/** Low damping: things overshoot and settle like jelly. */
export const JELLY = { type: 'spring', stiffness: 420, damping: 22, mass: 0.9 } as const;
const SHEET_SPRING = { type: 'spring', stiffness: 360, damping: 30 } as const;
export const STILL = { duration: 0 } as const;

const POPOVER_W = 212;
/** Space between a bar and its choice bubble (.nav-bubble in bottom-nav.css). */
const BUBBLE_GAP = 16;

/** The choice bubble's genie: it drains back as fast as it poured out (both reach 90% in ~0.3 s). */
const GENIE_OPEN = { type: 'spring', stiffness: 80, damping: 13, mass: 1, restDelta: 0.0005, restSpeed: 0.005 } as const;
/** Opening speed at the first frame, in progress per second (a full pour is 1). */
const GENIE_KICK = 6;
const GENIE_CLOSE = { type: 'spring', stiffness: 150, damping: 24, mass: 1, restDelta: 0.003, restSpeed: 0.01 } as const;
/** The lens taking a draining bubble in (ChoiceBubble absorb): it starts to bulge once the bubble
 *  is this far drained (progress), up to this much wider and taller, and relaxes back near the end. */
const LENS_SWELL_FROM = 0.5;
const LENS_SWELL_X = 0.05;
const LENS_SWELL_Y = 0.14;
const LENS_MERGE_AT = 0.03;
const LENS_SETTLE_MS = 420;
const smooth01 = (v: number) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };
/** How far into the lens's rounded top the genie's neck reaches, in px. */
const GENIE_NECK_DEPTH = 8;

/** A light tick on phones that support it, so a tap feels pressed. */
export const tick = () => navigator.vibrate?.(8);

/** One bar slot: a page, or a group of pages (a menu section) that opens a choice bubble above it. */
export interface Tab {
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
  const lensKey = openGroup ?? (moreOpen ? '__more' : activeTab?.key ?? '__more');
  const lensOn = (key: string) => key === lensKey;

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
              {lensOn(t.key) && lens}
              <JellyIcon on={lensOn(t.key)} reduce={!!reduce}>
                <NavIcon d={t.icon} size={22} />
                <Badge count={badge || null} />
              </JellyIcon>
              <span className={`bottom-nav-label ${t.label.length >= 10 ? 'long' : ''}`}>{t.label}</span>
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
          {lensOn('__more') && lens}
          <JellyIcon on={lensOn('__more')} reduce={!!reduce}>
            <span className="more-glyph" aria-hidden="true"><i /><i /><i /><i /></span>
            {!moreOpen && <Badge count={moreBadge || null} />}
          </JellyIcon>
          <span className="bottom-nav-label">{moreOpen ? 'Close' : 'More'}</span>
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
 */
export function JellyIcon({ on, reduce, className = 'bottom-nav-icon', children }: { on: boolean; reduce: boolean; className?: string; children: React.ReactNode }) {
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
    <motion.span className={className} whileTap={reduce ? undefined : { scaleX: 1.18, scaleY: 0.84 }} transition={JELLY}>
      <span ref={glyph} className="bottom-nav-glyph">{children}</span>
    </motion.span>
  );
}

/**
 * The glass bubble of a service's pages, pouring out of its tab like the macOS genie: up out of the
 * phone's bottom bar, or down out of the desktop's top bar (below).
 */
export function ChoiceBubble({ tab, navRef, anchor, pathname, badgeFor, reduce, below = false, lensClass = 'bottom-nav-lens', width = POPOVER_W }: {
  tab: Tab;
  navRef: React.RefObject<HTMLElement>;
  anchor: HTMLElement | null;
  pathname: string;
  badgeFor: (path: string) => number | null;
  reduce: boolean;
  /** Hangs under the bar instead of rising above it. */
  below?: boolean;
  /** The bar's glass lens, which the neck follows. */
  lensClass?: string;
  width?: number;
}) {
  const [pos, setPos] = useState<{ left: number; tail: number } | null>(null);
  const [isPresent, safeToRemove] = usePresence();
  const root = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // A motion value, so a tap mid-animation reverses from where it is, keeping its speed.
  const progress = useMotionValue(0);
  // The warped copy of the content, made on the first genie and kept until the bubble goes.
  const warpRef = useRef<{ layer: HTMLElement; slices: HTMLElement[] } | null>(null);
  useEffect(() => () => warpRef.current?.layer.remove(), []);

  // Centre over the tab, kept inside the bar; the tail still points at the tab.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !anchor) return;
    const navBox = nav.getBoundingClientRect();
    const btnBox = anchor.getBoundingClientRect();
    const centre = btnBox.left + btnBox.width / 2 - navBox.left;
    const left = Math.min(Math.max(centre - width / 2, 0), navBox.width - width);
    setPos({ left, tail: centre - left });
  }, [anchor, navRef, width]);

  // Pours out of the tab on open and drains back into it on close (lib/genie.ts). The clip goes on
  // the glass and the content separately: clipping the bubble itself would stop its glass from
  // blurring the page. Never fades, for the same reason. The tail hides meanwhile; the neck is the tail.
  useLayoutEffect(() => {
    const el = root.current;
    const g = glass.current;
    const b = body.current;
    if (!pos || !el || !g || !b) return;
    if (reduce) {
      if (!isPresent) safeToRemove?.();
      return;
    }
    const nav = navRef.current;
    const h = el.offsetHeight;
    // Below the bar, the geometry is measured upside down (lib/genie.ts genieFrameBelow). The
    // margin keeps the panel's shadow (~52px) inside the outline, or the outline would cut it
    // straight while the bubble grows.
    const margin = 60;
    const geometry = { width, height: h, neckY: h + margin, neckX: pos.tail, neckHalf: 26, margin };
    // The neck follows the glass lens wherever it is, read every frame: it lands on this tab before
    // the bubble opens, and slides back to the current page's tab while the bubble drains, pulling
    // the bubble along. The lens is a pill; the neck joins it a little way into its rounded top,
    // exactly as wide as the pill is there, so the bubble reads as drawn out of it.
    const followLens = () => {
      const lens = nav?.querySelector<HTMLElement>(`.${lensClass}`);
      if (!nav || !lens) return null;
      const n = nav.getBoundingClientRect();
      const r = lens.getBoundingClientRect();
      const radius = Math.min(r.width, r.height) / 2;
      const depth = Math.min(GENIE_NECK_DEPTH, radius);
      // The bubble rests BUBBLE_GAP above the bar (or below it), positioned from its left.
      geometry.neckX = r.left + r.width / 2 - (n.left + pos.left);
      if (below) {
        const restTop = n.bottom + BUBBLE_GAP;
        geometry.neckY = h - (r.bottom - depth - restTop);
      } else {
        const restTop = n.top - BUBBLE_GAP - h;
        geometry.neckY = r.top + depth - restTop;
      }
      geometry.neckHalf = r.width / 2 - radius + Math.sqrt(radius * radius - (radius - depth) ** 2);
      return lens;
    };
    // Draining, the lens takes the bubble back in like one blob of liquid merging into another: it
    // bulges toward the bubble as the last of it pours in (its far edge stays put), then relaxes
    // smoothly back to its own shape, without overshooting. Done on the CSS scale and translate
    // properties, which stack with the transform the lens's own movement uses.
    let swollen: HTMLElement | null = null;
    let merged = false;
    const bulge = (lens: HTMLElement, k: number) => {
      const sy = 1 + LENS_SWELL_Y * k;
      // Growing from the edge away from the bubble: up into a bubble above, down toward one below.
      const shift = ((sy - 1) * lens.offsetHeight) / 2;
      lens.style.scale = `${(1 + LENS_SWELL_X * k).toFixed(4)} ${sy.toFixed(4)}`;
      lens.style.translate = `0 ${(below ? shift : -shift).toFixed(2)}px`;
    };
    const unbulge = (lens: HTMLElement) => {
      lens.style.scale = '';
      lens.style.translate = '';
    };
    const absorb = (lens: HTMLElement | null, p: number) => {
      if (isPresent) {
        // Opened again mid-drain: the lens lets go of what it had taken in.
        if (swollen) unbulge(swollen);
        swollen = null;
        return;
      }
      if (!lens || merged) return;
      if (swollen && swollen !== lens) unbulge(swollen);
      swollen = lens;
      if (p > LENS_MERGE_AT) {
        bulge(lens, smooth01(1 - p / LENS_SWELL_FROM));
        return;
      }
      merged = true;
      const from = { scale: lens.style.scale || '1 1', translate: lens.style.translate || '0 0' };
      unbulge(lens);
      lens.animate([from, { scale: '1 1', translate: '0 0' }], { duration: LENS_SETTLE_MS, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
    };
    const rows = LITE_DEVICE ? 16 : 28;
    // Read once: reading layout right after writing a clip would force a style pass every frame.
    const bodyX = b.offsetLeft;
    const bodyY = b.offsetTop;
    const setClip = (node: HTMLElement, clip: string) => {
      node.style.clipPath = clip;
      node.style.setProperty('-webkit-clip-path', clip);
    };
    // The content is warped row by row, like macOS bends a window into its icon: while the genie
    // plays, the body is swapped for thin horizontal slices of a copy of it, each squeezed to the
    // width of the funnel at its height (lib/genie.ts genieWarp). The real body is back (clipped to
    // the outline) once the panel is full size, so only the copy ever looks bent.
    // Built once per bubble and reused, so tapping back and forth never rebuilds it.
    const bodyW = b.offsetWidth;
    const bodyH = b.offsetHeight;
    const sliceCount = LITE_DEVICE ? 6 : 10;
    const sliceH = bodyH / sliceCount;
    // Row centres as a fraction of the panel's height, measured from its far edge from the tab.
    const fracs = Array.from({ length: sliceCount }, (_, i) => {
      const r = (bodyY + (i + 0.5) * sliceH) / h;
      return below ? 1 - r : r;
    });
    let warp: HTMLElement | null = null;
    let slices: HTMLElement[] = [];
    const ensureWarp = () => {
      if (warp) return;
      // The copy is kept per tab and reused while its content is the same, so tapping back and forth
      // between tabs doesn't rebuild it each time.
      const cacheKey = `${tab.key}|${below}|${width}`;
      const html = b.innerHTML;
      let made = warpCache.get(cacheKey);
      if (!made || made.html !== html || made.bodyW !== bodyW || made.bodyH !== bodyH) {
        const layer = document.createElement('div');
        layer.className = 'nav-bubble-warp';
        layer.setAttribute('aria-hidden', 'true');
        layer.setAttribute('inert', '');
        const slices = Array.from({ length: sliceCount }, (_, i) => {
          const slice = document.createElement('div');
          slice.style.width = `${bodyW}px`;
          slice.style.height = `${sliceH + (i < sliceCount - 1 ? 1.5 : 0)}px`;
          const copy = b.cloneNode(true) as HTMLElement;
          copy.style.cssText = `position:absolute;left:0;top:${-i * sliceH}px;width:${bodyW}px;margin:0`;
          slice.appendChild(copy);
          layer.appendChild(slice);
          return slice;
        });
        made = { html, bodyW, bodyH, layer, slices };
        warpCache.set(cacheKey, made);
      }
      warp = made.layer;
      slices = made.slices;
      el.appendChild(warp);
      warpRef.current = made;
    };
    // Someone playing with the tabs gets the light version; the warp is for a calm tap. Decided once
    // per run, so the content never switches between bent and straight in the middle of a genie.
    const started = performance.now();
    const warpOff = started - lastGenieStart < 900;
    lastGenieStart = started;
    let reached = false;
    const apply = (p: number) => {
      absorb(followLens(), p);
      // While it drains, or before it has poured clear of the bar, the bubble's box lies over the
      // tabs: it must not take their taps (on phones a tap on the tab just as the bubble came back
      // landed on the bubble and was lost). On desktop it sits behind the bar and never did.
      el.style.pointerEvents = !isPresent || (p < 0.9 && !reached) ? 'none' : '';
      const { a, c, d, e, f, points } = (below ? genieFrameBelow : genieFrame)(p, geometry, rows);
      el.style.transform = `matrix(${a.toFixed(4)}, 0, ${c.toFixed(4)}, ${d.toFixed(4)}, ${e.toFixed(2)}, ${f.toFixed(2)})`;
      setClip(g, toClipPath(points));
      // Once full size, the real content stays: the spring's settling wobble dips just under full
      // and must not flick it back to the bent copy (that flickered, and swallowed taps on it).
      if (isPresent && p >= 0.999) reached = true;
      if (p < 0.999 && !warpOff && !reached) {
        ensureWarp();
        if (!warp) return;
        const bend = genieWarp(p, geometry, fracs);
        warp.style.display = '';
        b.style.visibility = 'hidden';
        // The warped copy is drawn stretched down into the bar; nothing of it shows past the bar's
        // edge, or its text would lie across the tab it comes out of.
        const edge = below ? -BUBBLE_GAP - f : h + BUBBLE_GAP - f;
        warp.style.clipPath = below
          ? `polygon(-999px ${edge.toFixed(1)}px, 999px ${edge.toFixed(1)}px, 999px 999px, -999px 999px)`
          : `polygon(-999px -999px, 999px -999px, 999px ${edge.toFixed(1)}px, -999px ${edge.toFixed(1)}px)`;
        slices.forEach((slice, i) => {
          const { left, right } = bend.rows[i];
          const sx = (right - left) / width;
          const y = bodyY + i * sliceH;
          const ty = below ? h * (1 - bend.d) + bend.d * y : bend.d * y;
          slice.style.transform = `translate(${(left + bodyX * sx).toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(4)}, ${bend.d.toFixed(4)})`;
        });
      } else {
        if (warp) warp.style.display = 'none';
        b.style.visibility = '';
        setClip(b, toClipPath(points, bodyX, bodyY));
      }
    };
    const unwarp = () => {
      if (warp) warp.style.display = 'none';
      b.style.visibility = '';
    };
    const settle = () => {
      unwarp();
      el.classList.remove('genie');
      el.style.pointerEvents = '';
      el.style.transform = '';
      setClip(g, '');
      setClip(b, '');
    };

    el.classList.add('genie');
    el.style.transformOrigin = '0 0';
    apply(progress.get());
    const unsubscribe = progress.on('change', apply);
    const controls = animate(progress, isPresent ? 1 : 0, {
      ...(isPresent ? GENIE_OPEN : GENIE_CLOSE),
      // The genie starts moving at the first frame after a tap. A spring from rest, run through the
      // genie's easing (lib/genie.ts), shows nothing for its first ~70 ms: a tap made just as the
      // bubble came back to the lens, when it is nearly closed, looked like it hadn't registered.
      // Closing starts from rest, so a tap during an opening turns it around at once.
      velocity: isPresent ? GENIE_KICK : 0,
      onComplete: () => (isPresent ? settle() : safeToRemove?.()),
    });
    return () => {
      controls.stop();
      unsubscribe();
      unwarp();
      if (swollen && !merged) unbulge(swollen);
    };
  }, [pos, isPresent, reduce, safeToRemove, progress, navRef, below, lensClass, width]);

  if (!pos) return null;
  return (
    <div ref={root} className={`nav-bubble ${below ? 'below' : ''}`} role="menu" aria-label={tab.label} style={{ left: pos.left, width }}>
      <span ref={glass} className="nav-bubble-glass" aria-hidden="true" />
      <span className="nav-bubble-tail" style={{ left: pos.tail }} aria-hidden="true" />
      <div ref={body} className="nav-bubble-body">
      {/* The tab is keyed by its section's full name: IT Services, Multimedia, ... */}
      <span className="nav-bubble-title">{tab.key}</span>
      {tab.links.map((l) => {
        const active = l.to === pathname;
        const badge = badgeFor(l.to);
        return (
            <Link
              key={l.to}
              to={l.to}
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
      </div>
    </div>
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

export function Badge({ count }: { count: number | null }) {
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
export function useHideOnScroll(paused: boolean): boolean {
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
