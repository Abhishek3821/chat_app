import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Attach bearer token (kept in localStorage as a fallback to the httpOnly cookie).
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Endpoints where a 401 means "wrong credentials", not "session expired" —
// they must NOT force a logout (e.g. a wrong current password on change-password).
const CREDENTIAL_401_PATHS = /\/auth\/(login|signup|verify-otp|resend-otp|forgot-password|reset-password|change-password)/;

// Normalise errors to a friendly message; auto-logout on an expired/invalid session.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.message || err.message || 'Something went wrong';
    if (err.response?.status === 401 && !CREDENTIAL_401_PATHS.test(err.config?.url || '')) {
      localStorage.removeItem('cc_token');
      // useAuth listens for this and clears the session; ProtectedRoute then
      // redirects to /login. An event avoids an api ⇄ store import cycle.
      window.dispatchEvent(new Event('cc:unauthorized'));
    }
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
