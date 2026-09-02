import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { setToken } from './lib/token';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import { useAuth } from './store/useAuth';
import api from './lib/api';

const CallsPage = lazy(() => import('./pages/CallsPage.jsx'));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage.jsx'));
const StatusPage = lazy(() => import('./pages/StatusPage.jsx'));
const GroupsPage = lazy(() => import('./pages/GroupsPage.jsx'));
const CommunitiesPage = lazy(() => import('./pages/CommunitiesPage.jsx'));
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage.jsx'));
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'));
const StarredPage = lazy(() => import('./pages/StarredPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

/**
 * The drop-in embed: the whole ChatKonect UI, inside a host product's page,
 * authenticated by the host's own login.
 *
 * A partner previously had to rebuild every screen against the REST + Socket.IO
 * surface, and configure the API origin, the socket origin and a TURN relay by
 * hand. Each of those was a place to be subtly wrong and see a SILENT failure —
 * which is what happened repeatedly. This route removes the whole category: the
 * host mints a user token (it already does that to call the API) and hands it
 * over; everything else is resolved here.
 *
 * THE TOKEN NEVER TRAVELS IN THE URL. Query strings land in browser history,
 * server access logs and the `Referer` header of every outbound request, and
 * this token is a live session. It arrives by postMessage from one verified
 * origin, and nowhere else.
 *
 * Routes here are a deliberate SUBSET of the first-party app: `/admin`,
 * `/developers` and `/platform` are omitted, because a tenant's end user must
 * never reach the admin console or the tenant-management console.
 *
 * Protocol (mirrored in `client/public/embed.js`):
 *   host  → embed   { source: 'chatkonect-host',  type: 'auth' | 'navigate', … }
 *   embed → host    { source: 'chatkonect-embed', type: 'awaiting-token' |
 *                     'config' | 'ready' | 'error' | 'token-expiring', … }
 */

const EMBED = 'chatkonect-embed';
const HOST = 'chatkonect-host';

/* Surfaces gated on a tenant capability. Anything absent from this map is always
   available (chat itself, contacts, starred, settings). `video` is deliberately
   not listed: video rides the `calls` flag server-side, so gating it separately
   here would hide a surface the server would still allow. */
const ROUTE_FEATURE = {
  calls: 'calls',
  meetings: 'meetings',
  status: 'status',
  groups: 'groups',
  communities: 'groups',
  broadcasts: 'chat',
};

function Notice({ title, body }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-slate-50 p-6 text-center dark:bg-slate-900">
      <div className="max-w-sm">
        {title ? (
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        ) : null}
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{body}</p>
      </div>
    </div>
  );
}

export default function EmbedApp() {
  const { user, loading, init } = useAuth();
  const navigate = useNavigate();
  const [fatal, setFatal] = useState(null);
  const [features, setFeatures] = useState(null);
  const [hasToken, setHasToken] = useState(false);

  /* Read once, synchronously: a later re-read could see a URL the host mutated. */
  const paramsRef = useRef(null);
  if (!paramsRef.current) {
    const q = new URLSearchParams(window.location.search);
    paramsRef.current = {
      appId: q.get('appId') || '',
      parentOrigin: q.get('parentOrigin') || '',
      tokenSeconds: Number(q.get('tokenSeconds')) || 3600,
    };
  }
  const { appId, parentOrigin, tokenSeconds } = paramsRef.current;

  const post = useCallback(
    (msg) => {
      // Never '*' — that would broadcast session state to whatever page framed us.
      if (parentOrigin && window.parent !== window) {
        window.parent.postMessage({ source: EMBED, ...msg }, parentOrigin);
      }
    },
    [parentOrigin]
  );

  /* ── Preflight: refuse to run in a shape we cannot secure ────────── */
  useEffect(() => {
    if (window.parent === window) {
      setFatal({
        code: 'not_embedded',
        message:
          'This is the embeddable surface. It must be loaded inside an iframe by the ChatKonect loader (embed.js).',
      });
      return;
    }
    if (!appId) {
      setFatal({ code: 'missing_app_id', message: 'No appId in the embed URL.' });
      return;
    }
    if (!parentOrigin) {
      /* With no declared parent origin there is no origin to verify messages
         against, and accepting a token from any frame would be an open door. */
      setFatal({
        code: 'missing_parent_origin',
        message: 'No parentOrigin in the embed URL — cannot verify who is sending the token.',
      });
      return;
    }
    try {
      // Throws on a malformed value, which must never become a postMessage target.
      new URL(parentOrigin);
    } catch {
      setFatal({ code: 'bad_parent_origin', message: `parentOrigin is not a valid origin: ${parentOrigin}` });
    }
  }, [appId, parentOrigin]);

  /* ── Bootstrap config: validates app + origin, returns capabilities ── */
  useEffect(() => {
    if (!appId || fatal) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/v1/embed/config', { params: { appId, parentOrigin } });
        if (cancelled) return;
        setFeatures(data.app?.features || []);
        post({ type: 'config', app: data.app, ice: data.ice });
      } catch (err) {
        if (cancelled) return;
        setFatal({
          code: 'config_failed',
          message: err?.response?.data?.message || err.message || 'Embed config request failed.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, parentOrigin, fatal, post]);

  /* ── The token handshake ─────────────────────────────────────────── */
  useEffect(() => {
    if (fatal) {
      post({ type: 'error', ...fatal });
      return undefined;
    }
    if (!parentOrigin) return undefined;

    const onMessage = async (event) => {
      /* Strict equality on the ORIGIN, never a prefix test — 'https://app.com.evil.net'
         passes a startsWith('https://app.com') check. */
      if (event.origin !== parentOrigin) return;
      const msg = event.data;
      if (!msg || msg.source !== HOST) return;

      if (msg.type === 'auth' && typeof msg.token === 'string' && msg.token) {
        setToken(msg.token);
        setHasToken(true);
        /* init() re-validates against /auth/me, so a ROTATED token is adopted
           without tearing the mounted UI down. */
        await init();
        const u = useAuth.getState().user;
        if (u) post({ type: 'ready', user: { id: u._id, name: u.name } });
        else post({ type: 'error', code: 'token_rejected', message: 'The user token was rejected.' });
        return;
      }

      if (msg.type === 'navigate' && typeof msg.to === 'string') {
        /* In-app route changes only. A protocol-relative or absolute URL would
           let the host point the frame at another site while it still carries
           our chrome. Driven through the router rather than history.pushState +
           a synthetic popstate — React Router does not observe pushState, so
           that silently did nothing — and the basename is applied for us. */
        if (msg.to.startsWith('/') && !msg.to.startsWith('//')) navigate(msg.to);
      }
    };

    window.addEventListener('message', onMessage);
    /* Announce readiness AFTER the listener is attached, or a host that replies
       synchronously races us and its token is dropped on the floor. */
    post({ type: 'awaiting-token' });
    return () => window.removeEventListener('message', onMessage);
  }, [parentOrigin, fatal, init, post, navigate]);

  /* Ask the host to re-mint before the session dies. The host is the only party
     that can: it holds the app secret, and the embed deliberately never receives
     a refresh token. */
  useEffect(() => {
    if (!user) return undefined;
    const warnAt = Math.max(tokenSeconds * 0.8, 60) * 1000;
    const t = setTimeout(
      () => post({ type: 'token-expiring', inSeconds: Math.round(tokenSeconds * 0.2) }),
      warnAt
    );
    return () => clearTimeout(t);
  }, [user, tokenSeconds, post]);

  if (fatal) return <Notice title="ChatKonect could not start" body={fatal.message} />;
  if (!hasToken || loading || !features) {
    return <Notice body="Connecting to ChatKonect…" />;
  }
  if (!user) return <Notice body="Waiting for a valid user token from the host application…" />;

  const allowed = (key) => !ROUTE_FEATURE[key] || features.includes(ROUTE_FEATURE[key]);

  return (
    <Suspense fallback={<Notice body="Loading…" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ChatsPage />} />
          {allowed('calls') && <Route path="/calls" element={<CallsPage />} />}
          {allowed('meetings') && <Route path="/meetings" element={<MeetingsPage />} />}
          {allowed('status') && <Route path="/status" element={<StatusPage />} />}
          {allowed('groups') && <Route path="/groups" element={<GroupsPage />} />}
          {allowed('communities') && <Route path="/communities" element={<CommunitiesPage />} />}
          {allowed('broadcasts') && <Route path="/broadcasts" element={<BroadcastsPage />} />}
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        {/* No /admin, /developers or /platform here, by design — see the header. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
