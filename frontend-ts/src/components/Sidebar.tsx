import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { BellIcon } from './NotificationPanel';
import { useLogoutTransition } from './LogoutTransition';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenNotifications: () => void;
  notificationsOpen: boolean;
}

function Sidebar({ collapsed, onToggle, onOpenNotifications, notificationsOpen }: SidebarProps) {
  const { user } = useAuth();
  const { signOut } = useLogoutTransition();
  const location = useLocation();

  const { counts, unread } = useNotification();
  const isOpen = !collapsed;
  const shouldReduceMotion = useReducedMotion();

  const badgeFor = (path: string): number | null => {
    if (path.includes('multimedia')) return counts.multimedia;
    if (path.includes('digitalmedia')) return counts.digitalMedia;
    if (path.includes('print-materials')) return counts.printMaterials;
    return null;
  };

  const ROLE_NAV: Record<string, Array<{ to?: string; icon?: string; label?: string; section?: string }>> = {
    CLIENT: [
      { section: 'IT Services' },
      { to: '/request', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18V12 M9 15h6', label: 'IT Request' },
      { to: '/requested', icon: 'M12 8v4l3 3 M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z', label: 'IT History' },
      { section: 'Multimedia' },
      { to: '/multimedia-request', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Request' },
      { to: '/multimedia-history', icon: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2', label: 'Multimedia History' },
      { section: 'Digital Media' },
      { to: '/digital-media-request', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Request' },
      { to: '/digitalmedia-history', icon: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2', label: 'Digital Media History' },
      { section: 'Print Materials' },
      { to: '/print-materials-request', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Request' },
      { to: '/print-materials-history', icon: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2', label: 'Print Materials History' },
    ],
    TECHNICIAN: [
      { section: 'Work' },
      { to: '/dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
      { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
    ],
    MULTIMEDIA: [
      { section: 'My Assignments' },
      { to: '/multimedia-dashboard', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Requests' },
      { to: '/digitalmedia-dashboard', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Requests' },
      { to: '/print-materials-dashboard', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Requests' },
      { section: '' },
      { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
    ],
    ADMIN: [
      { section: 'Admin' },
      { to: '/admin-dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
      { to: '/users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', label: 'Users' },
      { to: '/all-requests', icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', label: 'All Requests' },
      { to: '/audit-logs', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H9H8', label: 'Audit Log' },
      { to: '/signatories', icon: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z', label: 'Signatories' },
      { section: '' },
      { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
    ],
    IT_ADMIN: [
      { section: 'IT Management' },
      { to: '/it-dashboard', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', label: 'Dashboard' },
      { to: '/all-requests', icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', label: 'All Requests' },
      { section: '' },
      { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
    ],
    MULTIMEDIA_ADMIN: [
      { section: 'Management' },
      { to: '/multimedia-management', icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z', label: 'Multimedia Mgmt' },
      { to: '/digitalmedia-management', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4', label: 'Digital Media Mgmt' },
      { to: '/print-materials-management', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', label: 'Print Materials Mgmt' },
      { to: '/all-requests', icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', label: 'All Requests' },
      { section: '' },
      { to: '/reports', icon: 'M18 20V10 M12 20V4 M6 20v-6', label: 'Reports' },
    ],
  };

  const navItems = (() => {
    if (!user) return [];
    const userRoles = user.roles || [user.role];
    const seen = new Set<string>();
    const items: Array<{ to?: string; icon?: string; label?: string; section?: string }> = [];

    for (const r of userRoles) {
      const roleItems = ROLE_NAV[r];
      if (!roleItems) continue;
      for (const item of roleItems) {
        const key = item.to || item.section || item.label || '';
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
    return items;
  })();

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'open' : ''}`} onClick={onToggle} />
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo-frame">
            <img src="/solano-logo.png" alt="Solano" className="sidebar-logo" />
          </div>
          <div className="sidebar-brand-info">
            <span className="sidebar-brand-text">IT Request System</span>
            {!collapsed && user && (
              <span className="sidebar-user-name">{user.first_name} {user.last_name}</span>
            )}
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, i) => {
            if (item.section !== undefined) {
              if (!item.section) return <div key={i} className="sidebar-divider" />;
              return <div key={i} className="sidebar-section">{item.section}</div>;
            }
            const isActive = location.pathname === item.to;
            const badge = item.to ? badgeFor(item.to) : null;
            return (
              <Link key={i} to={item.to!} className={`sidebar-item ${isActive ? 'active' : ''}`} aria-current={isActive ? 'page' : undefined}>
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    className="sidebar-active-pill"
                    transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon?.split(' M').map((d, j) => <path key={j} d={j === 0 ? d : 'M' + d} />)}
                </svg>
                <span className="sidebar-label">{item.label}</span>
                {badge !== null && badge > 0 && <span className="sidebar-badge">{badge}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className={`sidebar-item sidebar-notif-btn ${notificationsOpen ? 'open' : ''}`}
            onClick={onOpenNotifications}
            title="Notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notificationsOpen}
          >
            <BellIcon />
            <span className="sidebar-label">Notifications</span>
            {unread > 0 && <span className="sidebar-badge">{unread > 99 ? '99+' : unread}</span>}
          </button>

          <Link to="/profile" className={`sidebar-item ${location.pathname === '/profile' ? 'active' : ''}`} aria-current={location.pathname === '/profile' ? 'page' : undefined}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="sidebar-label">Profile</span>
          </Link>

          <button className="sidebar-item sidebar-collapse-btn" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`collapse-icon ${collapsed ? 'flipped' : ''}`}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {!collapsed && <span className="sidebar-label">Hide sidebar</span>}
          </button>

          <button className="sidebar-item sidebar-logout-btn" onClick={signOut} title="Logout">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="sidebar-label">Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
