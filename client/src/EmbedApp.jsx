import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import lazyWithRetry from './lib/lazyWithRetry';
import { getToken, setToken, clearToken } from './lib/token';
import { bindEmbedRefresh, completeEmbedRefresh, tokenRefreshDelay } from './lib/embedSession';
import { EmbedCapabilities } from './lib/embedCapabilities';
import AppLayout from './components/layout/AppLayout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import { useAuth } from './store/useAuth';
import { useUI } from './store/useUI';
import api, { DEMO_MODE, ensureMediaToken } from './lib/api';

const CallsPage = lazyWithRetry(() => import('./pages/CallsPage.jsx'));
const MeetingsPage = lazyWithRetry(() => import('./pages/MeetingsPage.jsx'));
const MeetingRoom = lazyWithRetry(() => import('./pages/MeetingRoom.jsx'));
const JoinInvite = lazyWithRetry(() => import('./pages/JoinInvite.jsx'));
const StatusPage = lazyWithRetry(() => import('./pages/StatusPage.jsx'));
const GroupsPage = lazyWithRetry(() => import('./pages/GroupsPage.jsx'));
const CommunitiesPage = lazyWithRetry(() => import('./pages/CommunitiesPage.jsx'));
const BroadcastsPage = lazyWithRetry(() => import('./pages/BroadcastsPage.jsx'));
const ContactsPage = lazyWithRetry(() => import('./pages/ContactsPage.jsx'));
const StarredPage = lazyWithRetry(() => import('./pages/StarredPage.jsx'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage.jsx'));

function Notice({ body }) {
  return <div className="grid h-dvh place-items-center bg-surface p-6 text-center text-content"><p className="max-w-md text-sm">{body}</p></div>;
}

// The same product screens run under /embed. Operator consoles stay outside
// this tenant end-user surface. All host messages are origin AND source checked.
export default function EmbedApp() {
  const user = useAuth((s) => s.user);
  const theme = useUI((s) => s.theme);
  const accent = useUI((s) => s.accent);
  const navigate = useNavigate();
  const location = useLocation();
  const [fatal, setFatal] = useState(null);
  const [config, setConfig] = useState(null);
  const [features, setFeatures] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const params = useRef(null);
  const identity = useRef(null);
  if (!params.current) {
    const q = new URLSearchParams(window.location.search);
    params.current = { appId: q.get('appId') || '', parentOrigin: q.get('parentOrigin') || '', theme: q.get('theme') };
  }
  const { appId, parentOrigin } = params.current;
  const post = useCallback((msg) => {
    if (parentOrigin && window.parent !== window) window.parent.postMessage({ source: 'chatkonect-embed', ...msg }, parentOrigin);
  }, [parentOrigin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.parent === window) throw new Error('Load ChatKonect through embed.js inside your platform.');
        if (!appId) throw new Error('appId is required.');
        const origin = new URL(parentOrigin);
        if (!/^https?:$/.test(origin.protocol) || origin.origin !== parentOrigin) throw new Error('parentOrigin must be an HTTP(S) origin.');
        if (DEMO_MODE) throw new Error('Disable VITE_DEMO_MODE on the ChatKonect frontend to use platform integration.');
        const { data } = await api.get('/v1/embed/config', { params: { appId, parentOrigin }, skipAuthRefresh: true });
        if (cancelled) return;
        setConfig(data);
        post({ type: 'config', app: data.app, ice: data.ice, endpoints: data.endpoints });
      } catch (err) {
        if (!cancelled) setFatal({ code: 'config_failed', message: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [appId, parentOrigin, post]);

  useEffect(() => {
    if (fatal) { post({ type: 'error', ...fatal }); return undefined; }
    if (!config) return undefined;
    let cancelled = false;
    let generation = 0;
    const unbind = bindEmbedRefresh(() => post({ type: 'token-expiring' }));
    const onMessage = async (event) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      const msg = event.data;
      if (!msg || msg.source !== 'chatkonect-host') return;
      if (msg.type === 'auth-error') { completeEmbedRefresh(null); return; }
      if (msg.type === 'auth' && typeof msg.token === 'string' && msg.token) {
        const current = ++generation;
        try {
          const { data } = await api.get('/v1/embed/session', {
            params: { appId }, headers: { Authorization: `Bearer ${msg.token}` }, skipAuthRefresh: true,
          });
          if (cancelled || current !== generation) return;
          if (identity.current && identity.current !== data.user._id) throw new Error('User changed. Destroy and remount ChatKonect when your signed-in user changes.');
          const first = !identity.current;
          identity.current = data.user._id;
          setToken(msg.token);
          setSessionToken(msg.token);
          setFeatures(data.app.features || []);
          useAuth.setState({ user: data.user, loading: false });
          completeEmbedRefresh(msg.token);
          ensureMediaToken(true);
          post({ type: first ? 'ready' : 'token-refreshed', user: { id: data.user._id, externalId: data.user.externalId, name: data.user.name } });
        } catch (err) {
          if (cancelled || current !== generation) return;
          completeEmbedRefresh(null);
          post({ type: 'error', code: 'token_rejected', message: err.message });
        }
      }
      if (msg.type === 'navigate' && typeof msg.to === 'string' && /^\/(?!\/)/.test(msg.to) && !msg.to.includes('\\')) navigate(msg.to);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'awaiting-token' });
    return () => { cancelled = true; generation++; unbind(); window.removeEventListener('message', onMessage); };
  }, [config, fatal, parentOrigin, appId, navigate, post]);

  useEffect(() => {
    if (!sessionToken) return undefined;
    const request = () => post({ type: 'token-expiring' });
    const timer = setTimeout(request, tokenRefreshDelay(sessionToken, config?.userTokenSeconds));
    const onFocus = () => { if (tokenRefreshDelay(getToken() || '', config?.userTokenSeconds) <= 1000) request(); };
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(timer); window.removeEventListener('focus', onFocus); };
  }, [sessionToken, config, post]);

  useEffect(() => {
    if (user) useUI.getState().hydrateAppearance(user._id, user.settings || {});
  }, [user?._id]);
  useEffect(() => {
    if (['light', 'dark', 'system'].includes(params.current.theme)) useUI.getState().setTheme(params.current.theme);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.documentElement.dataset.accent = accent;
    };
    apply(); mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent]);
  useEffect(() => {
    const onLogout = () => { setSessionToken(null); clearToken(); post({ type: 'logout' }); };
    window.addEventListener('cc:embed-logout', onLogout);
    return () => window.removeEventListener('cc:embed-logout', onLogout);
  }, [post]);
  useEffect(() => {
    if (user) post({ type: 'navigate', to: location.pathname + location.search });
  }, [user?._id, location.pathname, location.search, post]);

  if (fatal) return <Notice body={fatal.message} />;
  if (!config || !sessionToken || !user || !features) return <Notice body="Waiting for your platform to connect ChatKonect..." />;
  const enabled = (feature) => features.includes(feature);
  return (
    <EmbedCapabilities.Provider value={features}>
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<Notice body="Loading..." />}>
          <Routes>
            {enabled('meetings') && <Route path="/meet/:code" element={<MeetingRoom />} />}
            {enabled('groups') && <Route path="/invite/g/:code" element={<JoinInvite kind="group" />} />}
            <Route path="/invite/u/:code" element={<JoinInvite kind="user" />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<ChatsPage />} />
              {enabled('calls') && <Route path="/calls" element={<CallsPage />} />}
              {enabled('meetings') && <Route path="/meetings" element={<MeetingsPage />} />}
              {enabled('status') && <Route path="/status" element={<StatusPage />} />}
              {enabled('groups') && <Route path="/groups" element={<GroupsPage />} />}
              {enabled('groups') && <Route path="/communities" element={<CommunitiesPage />} />}
              {enabled('chat') && <Route path="/broadcasts" element={<BroadcastsPage />} />}
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/starred" element={<StarredPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
    </EmbedCapabilities.Provider>
  );
}
