import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { BellIcon } from './NotificationPanel';
import { useLogoutTransition } from './LogoutTransition';
import { useNavItems, useNavBadge, NavIcon } from './navItems';

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

  const { unread } = useNotification();
  const isOpen = !collapsed;
  const shouldReduceMotion = useReducedMotion();

  const navItems = useNavItems();
  const badgeFor = useNavBadge();

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
                <NavIcon d={item.icon!} />
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
