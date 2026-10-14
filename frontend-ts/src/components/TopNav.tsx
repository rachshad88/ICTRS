import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, useVelocity } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { useLogoutTransition } from './LogoutTransition';
import { BellIcon } from './NotificationPanel';
import { homeFor } from '../routes';
import { useNavItems, useNavBadge, NavIcon, LOGOUT_ICON, type NavEntry, type NavLink } from './navItems';
import { ChoiceBubble, JellyIcon, Badge, useHideOnScroll, tick, JELLY, GENIE_WAIT, type Tab } from './BottomNav';

/** More tabs than this and their labels give way to icons on narrower screens. */
const ROOMY_TABS = 5;
const BUBBLE_W = 236;

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
 * bubble. Notifications, Profile and Logout sit at the right. The bar slides away while scrolling down.
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

  // The lens sits on the open bubble's tab, else the current page's (Profile included).
  const lensKey = openGroup ?? activeTab?.key ?? (pathname === '/profile' ? '__profile' : null);
  const lensOn = (key: string) => key === lensKey;
  const lastLensKey = useRef(lensKey);
  useEffect(() => { lastLensKey.current = lensKey; }, [lensKey]);

  // The lens is one element that springs its position and width to the tab under it. (A shared
  // layout animation would scale it between tabs of different widths, squashing its round ends.)
  // It flattens a little with speed, like a drop of liquid sliding along the bar.
  const lensX = useMotionValue(0);
  const lensY = useMotionValue(0);
  const lensW = useMotionValue(0);
  const lensH = useMotionValue(0);
  const lensO = useMotionValue(0);
  const lensSpeed = useVelocity(lensX);
  const lensSquash = useTransform(lensSpeed, (v) => 1 - Math.min(Math.abs(v) / 9000, 0.12));
  const lensShown = useRef(false);
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
        else animate(value, to, JELLY);
      }
    };
    place(!lensShown.current || !!reduce);
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
  }, [lensKey, reduce, lensX, lensY, lensW, lensH, lensO]);

  if (!user) return null;
  const initials = (user.first_name[0] ?? '') + (user.last_name[0] ?? '');

  return (
    <>
      <header ref={navRef} className={`top-nav ${hidden ? 'is-hidden' : ''} ${tabs.length > ROOMY_TABS ? 'crowded' : ''}`}>
        <span className="top-nav-glass" aria-hidden="true" />
        <motion.span
          className="top-nav-lens"
          aria-hidden="true"
          style={{ x: lensX, y: lensY, width: lensW, height: lensH, opacity: lensO, scaleY: reduce ? 1 : lensSquash }}
        >
          <span className="bottom-nav-lens-shine" />
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
                <span className="top-nav-label">{t.label}</span>
                {isGroup && (
                  <svg className={`top-nav-caret ${openGroup === t.key ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </>
            );
            const cls = `top-nav-item ${current ? 'current' : ''} ${lensOn(t.key) ? 'lensed' : ''}`;

            if (!isGroup) {
              return (
                <Link key={t.key} ref={(el) => { itemRefs.current[t.key] = el; }} to={t.links[0].to} className={cls} title={t.label} aria-current={current ? 'page' : undefined}>
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
                title={t.label}
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
            type="button"
            className={`top-nav-item top-nav-round ${notificationsOpen ? 'open' : ''}`}
            onClick={onOpenNotifications}
            data-notif-anchor
            title="Notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notificationsOpen}
          >
            <JellyIcon on={false} reduce={!!reduce} className="top-nav-icon">
              <BellIcon />
              <Badge count={unread || null} />
            </JellyIcon>
          </button>

          <Link
            ref={(el) => { itemRefs.current.__profile = el; }}
            to="/profile"
            className={`top-nav-item top-nav-profile ${lensOn('__profile') ? 'lensed current' : ''}`}
            title="Profile"
            aria-current={pathname === '/profile' ? 'page' : undefined}
          >
            <JellyIcon on={lensOn('__profile')} reduce={!!reduce} className="top-nav-icon">
              <span className="top-nav-avatar" aria-hidden="true">{initials}</span>
            </JellyIcon>
            <span className="top-nav-label top-nav-name">{user.first_name}</span>
          </Link>

          <button type="button" className="top-nav-item top-nav-round top-nav-logout" onClick={signOut} title="Logout" aria-label="Logout">
            <JellyIcon on={false} reduce={!!reduce} className="top-nav-icon">
              <NavIcon d={LOGOUT_ICON} size={19} />
            </JellyIcon>
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
              wait={lastLensKey.current !== openGroup ? GENIE_WAIT : 0}
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
