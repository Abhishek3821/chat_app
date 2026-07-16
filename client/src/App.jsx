import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { useUI } from './store/useUI';
import { useAuth } from './store/useAuth';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import LockScreen from './components/LockScreen.jsx';
import BusyCallBanner from './components/overlays/BusyCallBanner.jsx';

// Eager: the two first-paint entry points (logged-out landing + logged-in home)
// and the app shell. Everything else is code-split so the initial bundle stays
// small — the admin/charts, business, meetings screens no longer ship to users
// who never open them (better LCP/TBT).
import Login from './pages/auth/Login.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import ChatsPage from './pages/ChatsPage.jsx';

const Signup = lazy(() => import('./pages/auth/Signup.jsx'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword.jsx'));
const VerifyOtp = lazy(() => import('./pages/auth/VerifyOtp.jsx'));
const CallsPage = lazy(() => import('./pages/CallsPage.jsx'));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage.jsx'));
const StatusPage = lazy(() => import('./pages/StatusPage.jsx'));
const GroupsPage = lazy(() => import('./pages/GroupsPage.jsx'));
const CommunitiesPage = lazy(() => import('./pages/CommunitiesPage.jsx'));
const BusinessPage = lazy(() => import('./pages/BusinessPage.jsx'));
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage.jsx'));
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const DevelopersPage = lazy(() => import('./pages/DevelopersPage.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const MeetingRoom = lazy(() => import('./pages/MeetingRoom.jsx'));

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  // Two-step verification: gate the app behind a PIN once per browser session.
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('cc_unlocked') === '1');
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.twoStepEnabled && !unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
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
  const  theme = useUI((s) => s.theme);
  const  accent = useUI((s) => s.accent);
  const init = useAuth((s) => s.init);
  const userSettings = useAuth((s) => s.user?.settings);
  const location = useLocation();

  // Each logged-in user's OWN look: hydrate theme + accent from THEIR account so
  // preferences follow the person (not the browser) and never leak between users.
  useEffect(() => {
    if (!userSettings) return;
    if (userSettings.theme) useUI.getState().setTheme(userSettings.theme);
    useUI.getState().setAccent(userSettings.accent || 'indigo');
  }, [userSettings?.theme, userSettings?.accent]);

  // Apply the theme to <html>, resolving 'system' against the OS (and reacting to
  // the OS switching light/dark while 'system' is selected).
  useEffect(() => {
    const root = document.documentElement;
    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && !!mq?.matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    if (theme === 'system' && mq) {
      const onChange = () => apply();
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
    return undefined;
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
          around the Outlet, so the shell (nav/socket) never remounts. Suspense
          covers the lazily-loaded route chunks with the splash fallback. */}
      <Suspense fallback={<SplashScreen />}>
      <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/verify-otp" element={<VerifyOtp />} />

          {/* Immersive meeting room — protected but OUTSIDE the app shell (its own
              full-screen layout, like a Google Meet link). */}
          <Route
            path="/meet/:code"
            element={
              <ProtectedRoute>
                <MeetingRoom />
              </ProtectedRoute>
            }
          />

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
            <Route path="/communities" element={<CommunitiesPage />} />
            <Route path="/business" element={<BusinessPage />} />
            <Route path="/broadcasts" element={<BroadcastsPage />} />
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
      </Suspense>

      {/* Someone called while we were on another call / in a meeting. */}
      <BusyCallBanner />

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
