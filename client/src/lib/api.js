import axios from 'axios';

/**
 * Resolve the API base URL, tolerant of how VITE_API_URL is set:
 *  - blank            → '/api' (local dev proxy / same-origin)
 *  - backend origin   → 'https://api.example.com'      → '…/api'
 *  - full API base    → 'https://api.example.com/api'  → unchanged
 * Always ends with '/api'. This prevents the classic production bug where the
 * env var is set to the bare backend origin and every request 404s with
 * "Route not found: /auth/login" (the /api prefix is missing).
 */
function resolveApiBase() {
  const raw = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '/api';
  return /\/api$/i.test(raw) ? raw : `${raw}/api`;
}

const baseURL = resolveApiBase();

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Warm-up ping, fired the moment the app loads: free-tier hosts (Render) put
// idle backends to sleep and the first request eats the ~50 s cold start. By
// pinging /health immediately, the server is waking up WHILE the user types
// their credentials instead of when they hit "Sign in". Fire-and-forget.
if (typeof window !== 'undefined') {
  fetch(`${baseURL}/health`, { method: 'GET', cache: 'no-store' }).catch(() => {});
}

// Attach bearer token (kept in localStorage as a fallback to the httpOnly cookie).
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth-flow endpoints: a 401 here means "wrong credentials" or "no session yet",
// NOT "access token expired" — so we must NOT try to refresh or force a logout.
const AUTH_FLOW_PATHS = /\/auth\/(login|signup|email\/(send|verify)-code|verify-otp|resend-otp|forgot-password|reset-password|change-password|refresh)/;

// Single-flight refresh: many requests can 401 at once when the access token
// expires; they all await one /auth/refresh call (authenticated by the httpOnly
// refresh cookie) rather than stampeding it.
let refreshing = null;
export async function refreshAccessToken() {
  if (!refreshing) {
    refreshing = api
      .post('/auth/refresh')
      .then((r) => {
        const t = r.data?.token;
        if (t) localStorage.setItem('cc_token', t);
        return t || null;
      })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// Normalise errors to a friendly message; on an expired access token, refresh
// once and retry transparently; if refresh fails, the session is gone → logout.
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config || {};
    const status = err.response?.status;
    const url = original.url || '';

    if (status === 401 && !AUTH_FLOW_PATHS.test(url) && !original._retried) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
        return api(original); // replay the original request with the fresh token
      }
      // Refresh failed → session revoked/expired. useAuth clears state and
      // ProtectedRoute redirects to /login. An event avoids an api ⇄ store cycle.
      localStorage.removeItem('cc_token');
      window.dispatchEvent(new Event('cc:unauthorized'));
    }

    const message = err.response?.data?.message || err.message || 'Something went wrong';
    return Promise.reject(new Error(message));
  }
);

// Demo mode ONLY when explicitly enabled. (Previously a blank VITE_API_URL —
// the recommended dev-proxy setup — silently forced demo mode, so login/chat/
// calls all ran on mock data even with the backend running.)
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// A production build with no backend URL means every /api call hits the static
// host (Vercel answers POSTs with 405). Fail loudly so this is obvious.
if (import.meta.env.PROD && !DEMO_MODE && !import.meta.env.VITE_API_URL) {
  // eslint-disable-next-line no-console
  console.error(
    '[ChatConnect] VITE_API_URL is not set in this production build — API calls will fail. ' +
      'Set VITE_API_URL (e.g. https://your-backend.onrender.com/api) and VITE_SOCKET_URL in your host\'s env vars, then rebuild/redeploy.'
  );
}

// ── Authenticated media ──────────────────────────────────────────
// /uploads is no longer public: it requires a short-lived, media-only token.
// We fetch one after auth and cache it, then append it to media URLs. The
// long-lived session JWT is never placed in a URL.
let mediaToken = null;

export async function ensureMediaToken(force = false) {
  if (DEMO_MODE) return null;
  if (mediaToken && !force) return mediaToken;
  try {
    const { data } = await api.get('/upload/access');
    mediaToken = data.token;
  } catch {
    /* not fatal — media just won't load until a token is available */
  }
  return mediaToken;
}

export function clearMediaToken() {
  mediaToken = null;
}

/** Upload one or more files (multipart) → returns [{ url, name, size, mime }]. */
export async function uploadFiles(files) {
  const form = new FormData();
  [...files].forEach((f) => form.append('files', f));
  const { data } = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  await ensureMediaToken(); // make sure we can render the media we just uploaded
  return data.attachments || [];
}

/** Build a loadable URL for an uploaded file (leaves absolute/data/blob URLs untouched). */
export function mediaUrl(u) {
  if (!u) return '';
  if (/^(https?:|data:|blob:)/i.test(u)) return u;
  const origin = baseURL.replace(/\/api\/?$/, ''); // '' when proxied via '/api'
  const base = `${origin}${u}`;
  if (!mediaToken) return base;
  return `${base}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(mediaToken)}`;
}

export default api;
