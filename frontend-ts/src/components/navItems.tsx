import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

/** A link (to, icon, label, short) or a section heading (section; '' draws a divider). */
export interface NavEntry {
  to?: string;
  icon?: string;
  label?: string;
  /** Label for the mobile bottom bar, where space is tight. */
  short?: string;
  /** A heading; '' draws a divider. With icon and short, phones show it as one tab grouping its links;
   *  desktop folds titled sections into one tab too (TopNav.tsx). */
  section?: string;
}

export type NavLink = Required<Pick<NavEntry, 'to' | 'icon' | 'label'>> & NavEntry;

const ROLE_NAV: Record<string, NavEntry[]> = {
  CLIENT: [
    { section: 'IT Services', short: 'IT', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4 M7 8l3 3-3 3 M13 14h4' },
    { to: '/request', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18V12 M9 15h6', label: 'IT Request', short: 'New request' },
    { to: '/requested', icon: 'M12 8v4l3 3 M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z', label: 'IT History', short: 'History' },
    { section: 'Multimedia', short: 'Multimedia', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z' },
    { to: '/multimedia-request', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Request', short: 'New request' },
    { to: '/multimedia-history', icon: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2', label: 'Multimedia History', short: 'History' },
    { section: 'Digital Media', short: 'Digital', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20' },
    { to: '/digital-media-request', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Request', short: 'New request' },
    { to: '/digitalmedia-history', icon: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2', label: 'Digital Media History', short: 'History' },
    { section: 'Print Materials', short: 'Print', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z' },
    { to: '/print-materials-request', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Request', short: 'New request' },
    { to: '/print-materials-history', icon: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2', label: 'Print Materials History', short: 'History' },
  ],
  TECHNICIAN: [
    { section: 'Work' },
    { to: '/dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
    { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
  ],
  MULTIMEDIA: [
    { section: 'My Assignments' },
    { to: '/multimedia-dashboard', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Requests', short: 'Multimedia' },
    { to: '/digitalmedia-dashboard', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Requests', short: 'Digital' },
    { to: '/print-materials-dashboard', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Requests', short: 'Print' },
    { section: '' },
    { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
  ],
  ADMIN: [
    { section: 'Admin' },
    { to: '/admin-dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
    { to: '/all-requests', icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', label: 'All Requests', short: 'Requests' },
    // One tab with a choice bubble on desktop and phones; each is still its own page.
    { section: 'Management', short: 'Manage', icon: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6' },
    { to: '/users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', label: 'Users' },
    { to: '/signatories', icon: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z', label: 'Signatories' },
    { to: '/audit-logs', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H9H8', label: 'Audit Log' },
    { section: 'Assign Requests', short: 'Assign', icon: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
    { to: '/it-dashboard', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4 M7 8l3 3-3 3 M13 14h4', label: 'IT Requests', short: 'IT' },
    { to: '/multimedia-management', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Mgmt', short: 'Multimedia' },
    { to: '/digitalmedia-management', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Mgmt', short: 'Digital' },
    { to: '/print-materials-management', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Mgmt', short: 'Print' },
    { section: '' },
    { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
  ],
  IT_ADMIN: [
    { section: 'IT Management' },
    { to: '/it-dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
    { to: '/all-requests', icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', label: 'All Requests', short: 'Requests' },
    { section: '' },
    { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
  ],
  MULTIMEDIA_ADMIN: [
    { section: 'Management' },
    { to: '/media-dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
    { to: '/multimedia-management', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Mgmt', short: 'Multimedia' },
    { to: '/digitalmedia-management', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Mgmt', short: 'Digital' },
    { to: '/print-materials-management', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Mgmt', short: 'Print' },
    { section: '' },
    { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
  ],
};

export const PROFILE_ICON = 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
export const LOGOUT_ICON = 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9';

/** The account's menu: every role's entries in order, each link and heading once. */
export function useNavItems(): NavEntry[] {
  const { user } = useAuth();
  if (!user) return [];
  const seen = new Set<string>();
  const items: NavEntry[] = [];
  for (const r of user.roles || [user.role]) {
    for (const item of ROLE_NAV[r] ?? []) {
      const key = item.to || item.section || item.label || '';
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

/** Pending-work count shown beside a link, or null for links that have none. */
export function useNavBadge(): (path: string) => number | null {
  const { counts } = useNotification();
  return (path) => {
    if (path.includes('multimedia')) return counts.multimedia;
    if (path.includes('digitalmedia')) return counts.digitalMedia;
    if (path.includes('print-materials')) return counts.printMaterials;
    return null;
  };
}

/** Draws one of the path strings above; subpaths are separated by " M". */
export function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((p, j) => <path key={j} d={j === 0 ? p : 'M' + p} />)}
    </svg>
  );
}
