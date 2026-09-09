import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import Sidebar from './components/Sidebar';
import ToastNotifications from './components/ToastNotifications';
import PageTransition from './components/PageTransition';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Request from './pages/Request';
import Requested from './pages/Requested';
import Reports from './pages/Reports';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import MultimediaRequest from './pages/MultimediaRequest';
import MultimediaHistory from './pages/MultimediaHistory';
import MultimediaRequestsDashboard from './pages/MultimediaRequestsDashboard';
import MultimediaManagement from './pages/MultimediaManagement';
import DigitalMediaRequest from './pages/DigitalMediaRequest';
import DigitalMediaHistory from './pages/DigitalMediaHistory';
import DigitalMediaManagement from './pages/DigitalMediaManagement';
import DigitalMediaRequestsDashboard from './pages/DigitalMediaRequestsDashboard';
import PrintMaterialsRequest from './pages/PrintMaterialsRequest';
import PrintMaterialsHistory from './pages/PrintMaterialsHistory';
import PrintMaterialsManagement from './pages/PrintMaterialsManagement';
import PrintMaterialsDashboard from './pages/PrintMaterialsDashboard';
import AuditLogs from './pages/AuditLogs';
import ItAdminDashboard from './pages/ItAdminDashboard';
import AdminDashboard from './pages/AdminDashboard';

function ProtectedRoute({ children, allowedRoles, sidebarCollapsed, onToggleSidebar, isMobile }: { children: React.ReactNode; allowedRoles?: string[]; sidebarCollapsed: boolean; onToggleSidebar: () => void; isMobile: boolean }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  const userRoles = user.roles || [user.role];
  const primary = user.primary_role || user.role;

  if (allowedRoles && !allowedRoles.some(r => userRoles.includes(r))) {
    if (primary === 'CLIENT') return <Navigate to="/request" replace />;
    if (primary === 'MULTIMEDIA') return <Navigate to="/multimedia-dashboard" replace />;
    if (primary === 'IT_ADMIN') return <Navigate to="/it-dashboard" replace />;
    if (primary === 'MULTIMEDIA_ADMIN') return <Navigate to="/multimedia-management" replace />;
    if (primary === 'PROGRAMMER') return <Navigate to="/reports" replace />;
    if (primary === 'ADMIN') return <Navigate to="/admin-dashboard" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <>
      <Sidebar collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
      <div className={`app-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {isMobile && (
          <button className="mobile-menu-toggle" onClick={onToggleSidebar} aria-label="Toggle menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <PageTransition>{children}</PageTransition>
      </div>
    </>
  );
}

function AppRoutes() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(window.innerWidth < 768);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

  const routeProps = { sidebarCollapsed, onToggleSidebar: toggleSidebar, isMobile };

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedRoles={['TECHNICIAN']} {...routeProps}>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/it-dashboard"
        element={
          <ProtectedRoute allowedRoles={['IT_ADMIN']} {...routeProps}>
            <ItAdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/request"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <Request />
          </ProtectedRoute>
        }
      />
      <Route
        path="/requested"
        element={
          <ProtectedRoute {...routeProps}>
            <Requested />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute allowedRoles={['TECHNICIAN', 'ADMIN', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN', 'PROGRAMMER']} {...routeProps}>
            <Reports />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']} {...routeProps}>
            <UserManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin-dashboard"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']} {...routeProps}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute {...routeProps}>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/multimedia-request"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <MultimediaRequest />
          </ProtectedRoute>
        }
      />
      <Route
        path="/multimedia-history"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <MultimediaHistory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/multimedia-dashboard"
        element={
          <ProtectedRoute allowedRoles={['MULTIMEDIA']} {...routeProps}>
            <MultimediaRequestsDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/digitalmedia-dashboard"
        element={
          <ProtectedRoute allowedRoles={['MULTIMEDIA']} {...routeProps}>
            <DigitalMediaRequestsDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/multimedia-management"
        element={
          <ProtectedRoute allowedRoles={['MULTIMEDIA_ADMIN']} {...routeProps}>
            <MultimediaManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path="/digital-media-request"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <DigitalMediaRequest />
          </ProtectedRoute>
        }
      />
      <Route
        path="/digitalmedia-history"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <DigitalMediaHistory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/digitalmedia-management"
        element={
          <ProtectedRoute allowedRoles={['MULTIMEDIA_ADMIN']} {...routeProps}>
            <DigitalMediaManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path="/print-materials-request"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <PrintMaterialsRequest />
          </ProtectedRoute>
        }
      />
      <Route
        path="/print-materials-history"
        element={
          <ProtectedRoute allowedRoles={['CLIENT']} {...routeProps}>
            <PrintMaterialsHistory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/print-materials-management"
        element={
          <ProtectedRoute allowedRoles={['MULTIMEDIA_ADMIN']} {...routeProps}>
            <PrintMaterialsManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit-logs"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']} {...routeProps}>
            <AuditLogs />
          </ProtectedRoute>
        }
      />
      <Route
        path="/print-materials-dashboard"
        element={
          <ProtectedRoute allowedRoles={['MULTIMEDIA']} {...routeProps}>
            <PrintMaterialsDashboard />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <NotificationProvider>
              <ToastNotifications />
              <AppRoutes />
            </NotificationProvider>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
