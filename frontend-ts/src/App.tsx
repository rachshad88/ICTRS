import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { MotionConfig } from 'framer-motion';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/queryClient';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import Sidebar from './components/Sidebar';
import ToastNotifications from './components/ToastNotifications';
import ConnectionBanner from './components/ConnectionBanner';
import PageTransition from './components/PageTransition';
import ErrorBoundary from './components/ErrorBoundary';
import { LoginTransitionProvider } from './components/LoginTransition';
import { LogoutTransitionProvider } from './components/LogoutTransition';
import { PageCurtainProvider } from './components/PageCurtain';
import NotificationPanel, { BellIcon } from './components/NotificationPanel';
import { useNotification } from './contexts/NotificationContext';
import Landing from './pages/Landing';
import { PUBLIC_PAGES, PRIVATE_PAGES, PAGE_TITLES, canOpen, homeFor, preloadInOrder } from './routes';

function ProtectedRoute({ children, allowedRoles, sidebarCollapsed, onToggleSidebar, isMobile }: { children: React.ReactNode; allowedRoles?: string[]; sidebarCollapsed: boolean; onToggleSidebar: () => void; isMobile: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { unread } = useNotification();
  const [notifOpen, setNotifOpen] = useState(false);
  const toggleNotifications = () => setNotifOpen((o) => !o);
  const closeNotifications = useCallback(() => setNotifOpen(false), []);

  useEffect(() => {
    setNotifOpen(false);
  }, [location.pathname]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Accounts on the default password must change it before using anything else.
  if (user.is_default_password && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }

  const userRoles = user.roles || [user.role];
  const primary = user.primary_role || user.role;

  if (!canOpen(allowedRoles, userRoles)) {
    return <Navigate to={homeFor(primary)} replace />;
  }

  return (
    <>
      <Sidebar collapsed={sidebarCollapsed} onToggle={onToggleSidebar} onOpenNotifications={toggleNotifications} notificationsOpen={notifOpen} />
      <NotificationPanel open={notifOpen} onClose={closeNotifications} variant={isMobile ? 'sheet' : 'popover'} sidebarCollapsed={sidebarCollapsed} />
      <div className={`app-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {isMobile && (
          <header className="mobile-topbar">
            <button className="mobile-menu-toggle" onClick={onToggleSidebar} aria-label="Open menu" aria-expanded={!sidebarCollapsed}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <img src="/solano-logo.png" alt="" className="mobile-topbar-logo" />
            <span className="mobile-topbar-title">IT Request System</span>
            <button
              className="mobile-topbar-bell"
              onClick={toggleNotifications}
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              aria-expanded={notifOpen}
            >
              <BellIcon />
              {unread > 0 && <span className="notif-count">{unread > 99 ? '99+' : unread}</span>}
            </button>
          </header>
        )}
        <PageTransition>
          {/* A crash shows a message in the page area only; the sidebar keeps working. */}
          <ErrorBoundary variant="page" resetKey={location.pathname}>
            {/* Shown only if a page's file is still downloading; the sidebar stays put meanwhile. */}
            <Suspense fallback={<div className="loading">Loading...</div>}>{children}</Suspense>
          </ErrorBoundary>
        </PageTransition>
      </div>
    </>
  );
}

const SITE_TITLE = 'ITRS - Information Technology Request Systems';

/** Names the browser tab after the page, with the unread count first so a background tab shows it. */
function useDocumentTitle() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { unread } = useNotification();
  const page = PAGE_TITLES[pathname];
  const count = user && unread > 0 ? `(${unread > 99 ? '99+' : unread}) ` : '';
  useEffect(() => {
    document.title = count + (page ? `${page} · ITRS` : SITE_TITLE);
  }, [count, page]);
}

/**
 * Escape closes the topmost pop-up by pressing its button marked data-modal-dismiss (its Close,
 * Cancel or Back), so each pop-up keeps its own closing logic. A confirm dialog sits above the
 * pop-up it was asked from. Keys already handled inside (an open office list) are left alone.
 */
function useModalEscape() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const modals = document.querySelectorAll<HTMLElement>('.modal');
      if (modals.length === 0) return;
      const top = document.querySelector<HTMLElement>('.modal.confirm-modal') ?? modals[modals.length - 1];
      const dismiss = top.querySelector<HTMLButtonElement>('[data-modal-dismiss]:not(:disabled)');
      if (!dismiss) return;
      e.preventDefault();
      dismiss.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const MOBILE_QUERY = '(max-width: 768px)';

function AppRoutes() {
  const location = useLocation();
  useDocumentTitle();
  useModalEscape();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handleChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile, location.pathname]);

  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

  // Fetch pages ahead (routes.ts). Signed in: the home page now, then the rest of what the
  // account can open, plus /login for the logout transition. Signed out: the public pages once
  // the browser is idle, so the curtain transitions find them ready.
  const { user, loading } = useAuth();
  const userKey = user ? `${user.user_id}:${(user.roles || [user.role]).join(',')}` : '';
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    let start: () => void;
    if (user) {
      const roles = user.roles || [user.role];
      const home = homeFor(user.primary_role || user.role);
      const mine = PRIVATE_PAGES.filter((p) => canOpen(p.roles, roles));
      mine.find((p) => p.path === home)?.load().catch(() => {});
      // Reports carries the Word export library, so it goes last.
      const rest = [...mine.filter((p) => p.path !== home && p.path !== '/reports'), PUBLIC_PAGES['/login'], ...mine.filter((p) => p.path === '/reports')];
      start = () => !cancelled && preloadInOrder(rest);
    } else {
      start = () => !cancelled && preloadInOrder([PUBLIC_PAGES['/login'], PUBLIC_PAGES['/signup'], PUBLIC_PAGES['/guide']]);
    }
    const idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 4000 }) : window.setTimeout(start, 1500);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [loading, userKey]); // per account, not per profile edit (userKey stands in for user)

  const routeProps = { sidebarCollapsed, onToggleSidebar: toggleSidebar, isMobile };

  return (
    // Public pages arrive behind a curtain or on a direct visit; nothing to show while they load.
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Landing />} />
        {Object.entries(PUBLIC_PAGES).map(([path, { Page }]) => (
          <Route key={path} path={path} element={<Page />} />
        ))}
        {PRIVATE_PAGES.map(({ path, roles, Page }) => (
          <Route
            key={path}
            path={path}
            element={
              <ProtectedRoute allowedRoles={roles} {...routeProps}>
                <Page />
              </ProtectedRoute>
            }
          />
        ))}
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    // Last resort for a crash outside a page (public pages, providers): a reload screen, not a blank one.
    <ErrorBoundary variant="site">
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <AuthProvider>
            <BrowserRouter>
              <NotificationProvider>
                <LoginTransitionProvider>
                  <LogoutTransitionProvider>
                    <PageCurtainProvider>
                      <ToastNotifications />
                      <ConnectionBanner />
                      <AppRoutes />
                    </PageCurtainProvider>
                  </LogoutTransitionProvider>
                </LoginTransitionProvider>
              </NotificationProvider>
            </BrowserRouter>
          </AuthProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
