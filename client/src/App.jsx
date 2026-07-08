import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { useUI } from './store/useUI';
import { useAuth } from './store/useAuth';
import ErrorBoundary from './components/ErrorBoundary.jsx';

import Login from './pages/auth/Login.jsx';
import Signup from './pages/auth/Signup.jsx';
import ForgotPassword from './pages/auth/ForgotPassword.jsx';
import ResetPassword from './pages/auth/ResetPassword.jsx';
import VerifyOtp from './pages/auth/VerifyOtp.jsx';

import AppLayout from './components/layout/AppLayout.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import CallsPage from './pages/CallsPage.jsx';
import MeetingsPage from './pages/MeetingsPage.jsx';
import StatusPage from './pages/StatusPage.jsx';
import GroupsPage from './pages/GroupsPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import DevelopersPage from './pages/DevelopersPage.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** Admin-only route: non-admins are bounced back to the chat dashboard.
 *  (The API additionally enforces 403 on every /api/admin endpoint.) */
function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function SplashScreen() {
  return (
    <div className="grid h-screen place-items-center bg-[rgb(var(--app-bg))]">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
    </div>
  );
}

export default function App() {
  const theme = useUI((s) => s.theme);
  const accent = useUI((s) => s.accent);
  const init = useAuth((s) => s.init);
  const location = useLocation();

  // Apply theme class to <html>.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Apply the chosen accent — drives every brand-* colour + gradient (index.css).
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  // Bootstrap the session once.
  useEffect(() => {
    init();
  }, [init]);

  return (
    <ErrorBoundary resetKey={location.pathname}>
      {/* Route swaps are instant + reliable; page transitions live in AppLayout
          around the Outlet, so the shell (nav/socket) never remounts. */}
      <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/verify-otp" element={<VerifyOtp />} />

          {/* Protected app shell */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<ChatsPage />} />
            <Route path="/calls" element={<CallsPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/contacts" element={<ContactsPage  />} />
            <Route
              path="/developers"
              element={
                <AdminRoute>
                  <DevelopersPage />
                </AdminRoute>
              }
            />
            <Route path="/settings" element={<SettingsPage  />} />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster
        position="top-center"
        toastOptions={{
          className: '!bg-surface !text-content !border !border-border !shadow-soft-lg !rounded-2xl',
          duration: 3200,
          success: { iconTheme: { primary: '#06b6d4', secondary: '#fff' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />
    </ErrorBoundary>
  );
}
