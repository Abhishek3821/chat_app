import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster, toast, useToasterStore } from 'react-hot-toast';

import { useUI } from './store/useUI';
import { useChat } from './store/useChat';
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
const StarredPage = lazy(() => import('./pages/StarredPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const DevelopersPage = lazy(() => import('./pages/DevelopersPage.jsx'));
const PlatformPage = lazy(() => import('./pages/PlatformPage.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const MeetingRoom = lazy(() => import('./pages/MeetingRoom.jsx'));
const JoinInvite = lazy(() => import('./pages/JoinInvite.jsx'));

/**
 * Caps how many toasts can be on screen at once.
 *
 * Almost every mutation in the app confirms itself with a toast, and the
 * settings screens fire one PER toggle — so a normal "change a few things"
 * session stacked five or six of them in the same corner, each hanging around
 * for seconds. Nothing was broken; there was just no ceiling. Oldest-first
 * dismissal keeps the newest (the one that matches what you just did) visible.
 *
 * Done here rather than by passing an `id` at ~100 call sites: one rule, and it
 * covers toasts fired from stores and socket handlers too.
 */
const MAX_VISIBLE_TOASTS = 2;

function ToastLimiter() {
  const { toasts } = useToasterStore();
  useEffect(() => {
    toasts
      .filter((t) => t.visible)
      .slice(MAX_VISIBLE_TOASTS)
      .forEach((t) => toast.dismiss(t.id));
  }, [toasts]);
  return null;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  // Two-step verification: gate the app behind a PIN once per browser session.
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('cc_unlocked') === '1');
  if (loading) return <SplashScreen />;
  /* Carry where they were headed. Bouncing to a bare /login threw the
     destination away, which is what made a scanned QR do nothing on a phone
     that wasn't signed in: you'd log in and land on the chat list with the
     invite silently dropped. Login and Signup both return here afterwards. */
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
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
    <div className="grid h-[100dvh] place-items-center bg-[rgb(var(--app-bg))]">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
    </div>
  );
}

export default function App() {
  const  theme = useUI((s) => s.theme);
  const  accent = useUI((s) => s.accent);
  const init = useAuth((s) => s.init);
  const userId = useAuth((s) => s.user?._id);
  const userSettings = useAuth((s) => s.user?.settings);
  const location = useLocation();
  const navigate = useNavigate();

  // Each logged-in user's OWN look. This used to force the account's values over
  // whatever this browser had saved (and overwrite localStorage with them) on
  // every load, so a stale server copy permanently beat your latest choice.
  // hydrateAppearance keeps the account's value for a new device / a different
  // user, and otherwise trusts what you last picked here. See useUI.
  useEffect(() => {
    if (!userId || !userSettings) return;
    useUI.getState().hydrateAppearance(userId, userSettings);
  }, [userId, userSettings?.theme, userSettings?.accent]);

  // Apply the theme to <html>, resolving 'system' against the OS (and reacting to
  // the OS switching light/dark while 'system' is selected).
  /* Notification deep link: `/?chat=<id>`.
     The server has always put that URL on every message push, and the service
     worker has always navigated to it — but nothing here ever read the param, so
     tapping a notification dumped you on the chat LIST instead of the
     conversation it was about. Runs once the user is loaded (setActiveChat needs
     an authenticated session), then strips the param so a later refresh or a
     Back press doesn't silently reopen the same chat. */
  useEffect(() => {
    if (!userId) return;
    const chatId = new URLSearchParams(location.search).get('chat');
    if (!chatId) return;
    useChat.getState().setActiveChat(chatId);
    useUI.getState().setChatListOpen(false); // on a phone, show the conversation
    navigate(location.pathname, { replace: true });
  }, [userId, location.search, location.pathname, navigate]);

  /* Warm path for the same thing: when the app is ALREADY open, the service
     worker posts the chat id instead of navigating, so tapping a notification
     switches conversations without tearing down and re-booting the SPA. */
  useEffect(() => {
    if (!userId || !navigator.serviceWorker) return undefined;
    const onMessage = (event) => {
      if (event.data?.type !== 'cc:open-chat' || !event.data.chatId) return;
      useChat.getState().setActiveChat(event.data.chatId);
      useUI.getState().setChatListOpen(false);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [userId]);

  useEffect(() => {
    const root = document.documentElement;
    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && !!mq?.matches);
      root.classList.toggle('dark', dark);
      /* Keep the two things the CSS class alone can't reach in step — the same
         pair the pre-paint script in index.html sets, so switching the theme at
         runtime lands exactly where a reload would.
         `colorScheme` drives the browser's own chrome (scrollbars, native
         controls, autofill); `theme-color` drives the mobile browser bar and the
         PWA status bar, which was pinned to the dark navy in both themes. */
      root.style.colorScheme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#071A2B' : '#E4F2EA');
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

          {/* Invite landing pages (QR codes / shared links). Protected but outside
              the shell: they resolve the invite, then redirect into the app. */}
          <Route
            path="/invite/g/:code"
            element={
              <ProtectedRoute>
                <JoinInvite kind="group" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invite/u/:code"
            element={
              <ProtectedRoute>
                <JoinInvite kind="user" />
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
            <Route path="/starred" element={<StarredPage />} />
            <Route
              path="/developers"
              element={
                <AdminRoute>
                  <DevelopersPage />
                </AdminRoute>
              }
            />
            {/* Embeddable-platform console: tenants, capabilities, secrets. */}
            <Route
              path="/platform"
              element={
                <AdminRoute>
                  <PlatformPage />
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


      <ToastLimiter />
      <Toaster
        position="top-center"
        // Settings fires a confirmation per toggle (theme, accent, wallpaper,
        // presence, every notification switch…), so changing three things in a
        // row used to pile three 3.2s toasts on top of each other in the same
        // spot. `gutter` guarantees visible separation between whatever IS
        // stacked, and the container clears the 64px top bar instead of sitting
        // on it. ToastLimiter above caps how many can stack at once.
        gutter={10}
        containerStyle={{ top: 76 }}
        toastOptions={{
          className: '!bg-surface !text-content !border !border-border !shadow-soft-lg !rounded-2xl',
          duration: 2600,
          // Success rides the accent (via the same token the primary surfaces
          // use, so it recolors with the picker instead of staying teal); error
          // stays red because that's a semantic signal, not a brand colour.
          // `secondary` is the glyph punched out of the icon, so it tracks the
          // toast's own surface.
          success: { iconTheme: { primary: 'rgb(var(--accent-fill))', secondary: 'rgb(var(--surface))' } },
          error: { iconTheme: { primary: '#ef4444', secondary: 'rgb(var(--surface))' } },
        }}
      />
    </ErrorBoundary>
  );
}
