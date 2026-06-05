import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import Sidebar from './components/Sidebar';
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

function ProtectedRoute({ children, allowedRoles, sidebarCollapsed, onToggleSidebar }: { children: React.ReactNode; allowedRoles?: string[]; sidebarCollapsed: boolean; onToggleSidebar: () => void }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'CLIENT') return <Navigate to="/request" replace />;
    if (user.role === 'MULTIMEDIA') return <Navigate to="/multimedia-dashboard" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <>
      <Sidebar collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
      <div className={`app-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {children}
      </div>
    </>
  );
}

function AppRoutes() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(window.innerWidth < 768);

  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

  const routeProps = { sidebarCollapsed, onToggleSidebar: toggleSidebar };

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedRoles={['TECHNICIAN', 'ADMIN']} {...routeProps}>
            <Dashboard />
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
          <ProtectedRoute allowedRoles={['TECHNICIAN', 'ADMIN']} {...routeProps}>
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
          <ProtectedRoute allowedRoles={['ADMIN']} {...routeProps}>
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
          <ProtectedRoute allowedRoles={['ADMIN']} {...routeProps}>
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
          <ProtectedRoute allowedRoles={['ADMIN']} {...routeProps}>
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
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <NotificationProvider>
            <AppRoutes />
          </NotificationProvider>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
