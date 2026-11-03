import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, useVelocity } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { useLogoutTransition } from './LogoutTransition';
import { BellIcon } from './NotificationPanel';
import { homeFor } from '../routes';
import { LITE_DEVICE } from '../lib/motion';
import { useNavItems, useNavBadge, NavIcon, LOGOUT_ICON, type NavEntry, type NavLink } from './navItems';
import { ChoiceBubble, JellyIcon, Badge, useHideOnScroll, tick, JELLY, type Tab } from './BottomNav';

const BUBBLE_W = 236;
/** The lens following the mouse: quick and just short of bouncing, so it stops on the icon at once
 * instead of swinging past it and wobbling back, which takes longer the farther it travelled. */
const GLIDE = { type: 'spring', stiffness: 700, damping: 46, mass: 0.9 } as const;

/** The Mac dock: the icon under the pointer swells to this many times its size... */
const DOCK_MAX = 1.85;
/** ...and those within this many pixels of the pointer swell less, the further away the less. */
const DOCK_REACH = 150;
/** How quickly the dock swells when the pointer arrives, and settles when it leaves. */
const DOCK_IN_MS = 45;
const DOCK_OUT_MS = 80;
/** Only for a mouse: a touch has no pointer hovering near the icons. */
const CAN_DOCK =
  typeof window !== 'undefined' && !LITE_DEVICE && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * The Mac dock's magnification on the [data-dock] items. Sizes follow the pointer at once, as the
 * Mac's do; only arriving and leaving ease. Everything moves by transform, never by layout, so a
 * frame costs no reflow: each icon scales from its centre, and the items slide apart to make room,
 * the tabs spreading from their middle and the actions from the bar's right end. Distances are measured from where the icons rest, so they
 * don't chase their own growth. While a bubble or the notifications are open the icons hold still,
 * as the Mac dock does under a menu: the bubble is placed by its tab. The glass lens rides along,
 * shifted as much as the dock has moved the spot under it, so it stays on its tab even mid-slide.
 */
function useDock(
  navRef: React.RefObject<HTMLElement>,
  frozen: boolean,
  off: boolean,
  lens: { centre: () => number; moving: () => boolean },
) {
  const frozenRef = useRef(frozen);
  const kickRef = useRef<() => void>(() => {});
  const lensRef = useRef(lens);
  frozenRef.current = frozen;
  lensRef.current = lens;

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || off || !CAN_DOCK) return;
    let pointer: { x: number; y: number } | null = null;
    let lastX = 0;
    let amount = 0;
    let raf = 0;
    let last = 0;
    const touched = new Set<HTMLElement>();
    const lensEl = nav.querySelector<HTMLElement>('.top-nav-lens-track');
    // Each item's resting centre (from the bar's left) and how far the dock has moved it.
    let moved: Array<[number, number]> = [];

    // The glass lens rides along: between two items, by as much as the spot under it has moved.
    // (Not scaled: a scale would apply to the offset the lens is placed by too, throwing it off.)
    const placeLens = () => {
      if (!lensEl || !moved.length) return;
      const at = lensRef.current.centre();
      let shift = at <= moved[0][0] ? moved[0][1] : moved[moved.length - 1][1];
      for (let i = 1; i < moved.length; i++) {
        const [a, sa] = moved[i - 1];
        const [b, sb] = moved[i];
        if (at > a && at <= b) shift = sa + ((sb - sa) * (at - a)) / (b - a);
      }
      lensEl.style.translate = shift ? `${shift.toFixed(2)}px 0` : '';
    };

    const frame = (now: number) => {
      raf = 0;
      if (frozenRef.current) {
        // The icons hold still, but a lens still sliding to the clicked tab must land on it as it
        // stands now, not where the spot under the lens was when the click came.
        last = 0;
        placeLens();
        if (lensRef.current.moving()) raf = requestAnimationFrame(frame);
        return;
      }
      const dt = last ? Math.min(now - last, 50) : 16;
      last = now;
      // Only the bar itself counts, not a bubble hanging under it.
      const bar = nav.getBoundingClientRect();
      const inside = !!pointer && pointer.y <= bar.bottom + 10;
      if (inside) lastX = pointer!.x;
      const goal = inside ? 1 : 0;
      amount += (goal - amount) * (1 - Math.exp(-dt / (inside ? DOCK_IN_MS : DOCK_OUT_MS)));
      if (Math.abs(goal - amount) < 0.002) amount = goal;

      // Offsets are layout positions, which the transforms leave alone: the resting dock.
      const clusters = [nav.querySelector('.top-nav-tabs'), nav.querySelector('.top-nav-actions')];
      moved = [];
      clusters.forEach((cluster, c) => {
        if (!cluster) return;
        const items = Array.from(cluster.querySelectorAll<HTMLElement>(':scope > [data-dock]'));
        const sized = items.map((el) => {
          const icon = el.querySelector<HTMLElement>('.top-nav-icon')!;
          const centre = bar.left + el.offsetLeft + icon.offsetLeft + icon.offsetWidth / 2;
          const d = Math.abs(lastX - centre);
          const swell = amount && d < DOCK_REACH ? (amount * (1 + Math.cos((Math.PI * d) / DOCK_REACH))) / 2 : 0;
          // The avatar already fills most of the bar's height, so it swells less.
          const s = 1 + (DOCK_MAX - 1) * swell * (el.dataset.dock === 'soft' ? 0.3 : 1);
          return { el, icon, s, grow: icon.offsetWidth * (s - 1) };
        });
        const total = sized.reduce((n, i) => n + i.grow, 0);
        let before = 0;
        for (const { el, icon, s, grow } of sized) {
          // Tabs spread from their middle; the actions from the bar's end, so none leave it.
          const shift = c === 0 ? before + grow / 2 - total / 2 : before + grow / 2 - total;
          before += grow;
          el.style.translate = shift ? `${shift.toFixed(2)}px 0` : '';
          icon.style.scale = s > 1 ? s.toFixed(4) : '';
          touched.add(el);
          moved.push([el.offsetLeft + el.offsetWidth / 2, shift]);
        }
      });
      placeLens();

      if (amount !== goal || inside) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pointer = { x: e.clientX, y: e.clientY };
      kick();
    };
    const onLeave = () => {
      pointer = null;
      kick();
    };
    nav.addEventListener('pointermove', onMove);
    nav.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      nav.removeEventListener('pointermove', onMove);
      nav.removeEventListener('pointerleave', onLeave);
      kickRef.current = () => {};
      for (const el of touched) {
        el.style.translate = '';
        el.querySelector<HTMLElement>('.top-nav-icon')?.style.removeProperty('scale');
      }
      lensEl?.style.removeProperty('translate');
    };
  }, [navRef, off]);

  // Picks up where the pointer is now once the bubble or panel closes; on opening, lands the lens.
  useEffect(() => {
    kickRef.current();
  }, [frozen]);

  // For the lens to call when it sets off: with the dock frozen, nothing else would keep it on its tab.
  return useCallback(() => kickRef.current(), []);
}

/**
 * Desktop tabs. A client's services (IT, Multimedia, ...) each get one tab with a choice bubble of
 * their pages, as on phones. Staff see their first section's pages as tabs; each later titled
 * section with several pages (an admin's Assign Requests) folds into one tab with a bubble.
 */
function buildTabs(items: NavEntry[]): Tab[] {
  const groups: Array<{ head?: NavEntry; links: NavLink[] }> = [];
  for (const item of items) {
    if (item.section !== undefined) groups.push({ head: item, links: [] });
    else if (item.to) {
      if (!groups.length) groups.push({ links: [] });
      groups[groups.length - 1].links.push(item as NavLink);
    }
  }
  const services = groups.filter((g) => g.head?.section && g.head.icon && g.links.length).length >= 2;
  const pageTab = (l: NavLink): Tab => ({ key: l.to, label: l.label, icon: l.icon, links: [l] });
  return groups.flatMap((g, i) =>
    g.head?.section && g.links.length > 1 && (services || i > 0)
      ? [{ key: g.head.section, label: g.head.section, icon: g.head.icon ?? g.links[0].icon, links: g.links }]
      : g.links.map(pageTab),
  );
}

/**
 * Desktop navigation: a floating liquid-glass bar across the top, the phone bar's sibling. The same
 * glass lens jelly-springs between tabs, and a service's pages pour down out of its tab in a genie
 * bubble. Notifications, Profile and Logout sit at the right. The bar slides away while scrolling down. The
 * tabs are icons only, named in a tip on hover, and with a mouse every icon swells toward the
 * pointer like the Mac dock's (useDock).
 */
function TopNav({ onOpenNotifications, notificationsOpen }: { onOpenNotifications: () => void; notificationsOpen: boolean }) {
  const { user } = useAuth();
  const { unread } = useNotification();
  const { signOut } = useLogoutTransition();
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  const items = useNavItems();
  const badgeFor = useNavBadge();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const hidden = useHideOnScroll(openGroup !== null || notificationsOpen);
  const navRef = useRef<HTMLElement>(null);
  // Every tab that can hold the lens, by key: the bubble anchors on these too.
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  // The item under the mouse, which the lens slides to.
  const [hovered, setHovered] = useState<string | null>(null);
  const hover = (key: string) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovered(key);
  };

  const tabs = buildTabs(items);
  const activeTab = tabs.find((t) => t.links.some((l) => l.to === pathname));
  const tabBadge = (t: Tab) => t.links.reduce((n, l) => n + (badgeFor(l.to) ?? 0), 0);

  useEffect(() => setOpenGroup(null), [pathname]);

  // Escape or a click anywhere else closes the choice bubble.
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

  // The lens sits on the open bubble's tab (which it pours out of), else the item under the mouse,
  // else the current page's (Profile included).
  const lensKey = openGroup ?? hovered ?? activeTab?.key ?? (pathname === '/profile' ? '__profile' : null);
  const lensOn = (key: string) => key === lensKey;

  // The lens is one element that springs its position and width to the tab under it. (A shared
  // layout animation would scale it between tabs of different widths, squashing its round ends.)
  // It flattens a little with speed, like a drop of liquid sliding along the bar. Following the
  // mouse it glides; landing on a page it springs like jelly.
  const lensX = useMotionValue(0);
  const lensY = useMotionValue(0);
  const lensW = useMotionValue(0);
  const lensH = useMotionValue(0);
  const lensO = useMotionValue(0);
  const lensSpeed = useVelocity(lensX);
  const lensSquash = useTransform(lensSpeed, (v) => 1 - Math.min(Math.abs(v) / 9000, 0.12));
  const lensShown = useRef(false);
  const lensSpring = hovered ? GLIDE : JELLY;
  // A press puts the lens on the pressed item at once: one still gliding over (or, on a touch
  // screen, one that would only set off on the tap) read as the click lagging. Jumping stops the
  // spring, so when the lens's item then changes to this one it has nowhere left to go.
  const press = (key: string) => () => {
    const el = itemRefs.current[key];
    if (!el || reduce) return;
    lensX.jump(el.offsetLeft);
    lensY.jump(el.offsetTop);
    lensW.jump(el.offsetWidth);
    lensH.jump(el.offsetHeight);
    landLens();
  };
  const landLens = useDock(navRef, openGroup !== null || notificationsOpen, !!reduce, {
    centre: () => lensX.get() + lensW.get() / 2,
    moving: () => lensX.isAnimating(),
  });
  useLayoutEffect(() => {
    const el = lensKey ? itemRefs.current[lensKey] : null;
    if (!el) {
      lensShown.current = false;
      animate(lensO, 0, { duration: 0.15 });
      return;
    }
    // Offsets are relative to the bar and ignore its slide-away transform.
    const place = (instant: boolean) => {
      const target: Array<[typeof lensX, number]> = [[lensX, el.offsetLeft], [lensY, el.offsetTop], [lensW, el.offsetWidth], [lensH, el.offsetHeight]];
      for (const [value, to] of target) {
        if (instant) value.jump(to);
        else animate(value, to, lensSpring);
      }
    };
    place(!lensShown.current || !!reduce);
    landLens();
    lensShown.current = true;
    animate(lensO, 1, { duration: 0.15 });
    // Labels fold away at narrower widths and fonts arrive late: follow the tab if its box changes.
    // (The observer also reports once on start; that must not cut the spring short.)
    const box = () => `${el.offsetLeft},${el.offsetTop},${el.offsetWidth},${el.offsetHeight}`;
    let last = box();
    const ro = new ResizeObserver(() => {
      const now = box();
      if (now === last) return;
      last = now;
      place(true);
    });
    ro.observe(el);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
    // The spring is read when the lens moves; switching it alone must not move the lens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensKey, reduce, lensX, lensY, lensW, lensH, lensO, landLens]);

  if (!user) return null;
  const initials = (user.first_name[0] ?? '') + (user.last_name[0] ?? '');

  return (
    <>
      <header
        ref={navRef}
        onPointerLeave={() => setHovered(null)}
        onPointerMove={(e) => {
          // Down in a bubble is no longer on the bar.
          if (e.clientY > e.currentTarget.getBoundingClientRect().bottom) setHovered(null);
        }}
        className={`top-nav ${hidden ? 'is-hidden' : ''} ${openGroup || notificationsOpen ? 'menu-open' : ''} ${CAN_DOCK && !reduce ? 'docking' : ''}`}>
        <span className="top-nav-glass" aria-hidden="true" />
        {/* The track carries the lens along the bar; the glass inside is what a draining bubble
            swells (ChoiceBubble). Swelling the track itself would scale the offset it is placed by
            too, sliding the lens off its tab. */}
        <motion.span
          className="top-nav-lens-track"
          aria-hidden="true"
          style={{ x: lensX, y: lensY, width: lensW, height: lensH, opacity: lensO, scaleY: reduce ? 1 : lensSquash }}
        >
          <span className="top-nav-lens">
            <span className="bottom-nav-lens-shine" />
          </span>
        </motion.span>

        <Link to={homeFor(user.primary_role || user.role)} className="top-nav-brand" aria-label="IT Request System, home">
          <span className="top-nav-logo"><img src="/solano-logo.png" alt="" /></span>
          <span className="top-nav-brand-text">IT Request System</span>
        </Link>

        <nav className="top-nav-tabs" aria-label="Main">
          {tabs.map((t) => {
            const isGroup = t.links.length > 1;
            const current = activeTab?.key === t.key;
            const content = (
              <>
                <JellyIcon on={lensOn(t.key)} reduce={!!reduce} className="top-nav-icon">
                  <NavIcon d={t.icon} size={19} />
                  <Badge count={tabBadge(t) || null} />
                </JellyIcon>
                <span className="top-nav-tip" aria-hidden="true">{t.label}</span>
              </>
            );
            const cls = `top-nav-item ${current ? 'current' : ''} ${lensOn(t.key) ? 'lensed' : ''}`;

            if (!isGroup) {
              return (
                <Link key={t.key} ref={(el) => { itemRefs.current[t.key] = el; }} to={t.links[0].to} className={cls} data-dock onPointerEnter={hover(t.key)} onPointerDown={press(t.key)} aria-label={t.label} aria-current={current ? 'page' : undefined}>
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={t.key}
                ref={(el) => { itemRefs.current[t.key] = el; }}
                type="button"
                className={cls}
                data-dock
                onPointerEnter={hover(t.key)}
                onPointerDown={press(t.key)}
                aria-label={t.label}
                aria-expanded={openGroup === t.key}
                aria-haspopup="menu"
                onClick={() => {
                  tick();
                  setOpenGroup((g) => (g === t.key ? null : t.key));
                }}
              >
                {content}
              </button>
            );
          })}
        </nav>

        <div className="top-nav-actions">
          <button
            ref={(el) => { itemRefs.current.__bell = el; }}
            type="button"
            className={`top-nav-item top-nav-round ${notificationsOpen ? 'open' : ''} ${lensOn('__bell') ? 'lensed' : ''}`}
            onClick={onOpenNotifications}
            data-notif-anchor
            data-dock
            onPointerEnter={hover('__bell')}
            onPointerDown={press('__bell')}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notificationsOpen}
          >
            <JellyIcon on={lensOn('__bell')} reduce={!!reduce} className="top-nav-icon">
              <BellIcon />
              <Badge count={unread || null} />
            </JellyIcon>
            <span className="top-nav-tip" aria-hidden="true">Notifications</span>
          </button>

          <Link
            ref={(el) => { itemRefs.current.__profile = el; }}
            to="/profile"
            className={`top-nav-item top-nav-profile ${pathname === '/profile' ? 'current' : ''} ${lensOn('__profile') ? 'lensed' : ''}`}
            data-dock="soft"
            onPointerEnter={hover('__profile')}
            onPointerDown={press('__profile')}
            aria-label={`Profile, ${user.first_name}`}
            aria-current={pathname === '/profile' ? 'page' : undefined}
          >
            <JellyIcon on={lensOn('__profile')} reduce={!!reduce} className="top-nav-icon">
              <span className="top-nav-avatar" aria-hidden="true">{initials}</span>
            </JellyIcon>
            <span className="top-nav-label top-nav-name" aria-hidden="true">{user.first_name}</span>
            <span className="top-nav-tip" aria-hidden="true">Profile</span>
          </Link>

          <button
            ref={(el) => { itemRefs.current.__logout = el; }}
            type="button"
            className={`top-nav-item top-nav-round top-nav-logout ${lensOn('__logout') ? 'lensed' : ''}`}
            onClick={signOut}
            aria-label="Logout"
            data-dock
            onPointerEnter={hover('__logout')}
            onPointerDown={press('__logout')}
          >
            <JellyIcon on={lensOn('__logout')} reduce={!!reduce} className="top-nav-icon">
              <NavIcon d={LOGOUT_ICON} size={19} />
            </JellyIcon>
            <span className="top-nav-tip" aria-hidden="true">Logout</span>
          </button>
        </div>

        <AnimatePresence>
          {openGroup && (
            <ChoiceBubble
              key={openGroup}
              tab={tabs.find((t) => t.key === openGroup)!}
              navRef={navRef}
              anchor={itemRefs.current[openGroup] ?? null}
              pathname={pathname}
              badgeFor={badgeFor}
              reduce={!!reduce}
              below
              lensClass="top-nav-lens"
              width={BUBBLE_W}
            />
          )}
        </AnimatePresence>
      </header>

      <AnimatePresence>
        {openGroup && (
          <motion.div
            key="top-nav-veil"
            className="bottom-nav-veil top-nav-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default TopNav;
