import axios from 'axios';
import { getToken, setToken, clearToken } from './token';
import { IS_EMBED, requestEmbedRefresh } from './embedSession';

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
  withCredentials: !IS_EMBED,
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
  const token = getToken();
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
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
  if (IS_EMBED) return requestEmbedRefresh();
  if (!refreshing) {
    refreshing = api
      .post('/auth/refresh')
      .then((r) => {
        const t = r.data?.token;
        if (t) setToken(t);
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

    if (status === 401 && !original.skipAuthRefresh && !AUTH_FLOW_PATHS.test(url) && !original._retried) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
        return api(original); // replay the original request with the fresh token
      }
      // Refresh failed → session revoked/expired. useAuth clears state and
      // ProtectedRoute redirects to /login. An event avoids an api ⇄ store cycle.
      clearToken();
      window.dispatchEvent(new Event('cc:unauthorized'));
    }

    const message = err.response?.data?.message || err.message || 'Something went wrong';
    // Preserve status and response for the embed's actionable error reporting.
    err.message = message;
    return Promise.reject(err);
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
    '[ChatKonect] VITE_API_URL is not set in this production build — API calls will fail. ' +
      'Set VITE_API_URL (e.g. https://your-backend.onrender.com/api) and VITE_SOCKET_URL in your host\'s env vars, then rebuild/redeploy.'
  );
}

// ── Authenticated media ──────────────────────────────────────────
// /uploads is no longer public: it requires a short-lived, media-only token.
// We fetch one after auth and cache it, then append it to media URLs. The
// long-lived session JWT is never placed in a URL.
let mediaToken = null;
/* The media token is short-lived (the server signs it for 6h) but used to be
   fetched once and cached forever — so a long-lived tab or installed PWA showed
   broken images, videos and voice notes after six hours, until a reload. Track
   its expiry and renew it ahead of time, including when a sleeping/backgrounded
   tab (whose timers were paused) becomes visible again. */
let mediaTokenExp = 0; // ms epoch
let mediaRefreshTimer = null;
let mediaInFlight = null;
const MEDIA_REFRESH_EARLY_MS = 10 * 60 * 1000;
const MEDIA_FALLBACK_TTL_MS = 5 * 60 * 60 * 1000; // if exp can't be read

function jwtExpiryMs(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    return json.exp ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

const mediaTokenStale = () => Boolean(mediaToken) && Date.now() > mediaTokenExp - MEDIA_REFRESH_EARLY_MS;

function scheduleMediaRefresh() {
  clearTimeout(mediaRefreshTimer);
  if (!mediaToken) return;
  const delay = Math.max(30_000, mediaTokenExp - MEDIA_REFRESH_EARLY_MS - Date.now());
  mediaRefreshTimer = setTimeout(() => ensureMediaToken(true), Math.min(delay, 2 ** 31 - 1));
}

export async function ensureMediaToken(force = false) {
  if (DEMO_MODE) return null;
  if (mediaToken && !force && !mediaTokenStale()) return mediaToken;
  if (mediaInFlight) return mediaInFlight; // one request, however many callers
  mediaInFlight = (async () => {
    try {
      const { data } = await api.get('/upload/access');
      mediaToken = data.token;
      mediaTokenExp = jwtExpiryMs(mediaToken) || Date.now() + MEDIA_FALLBACK_TTL_MS;
      scheduleMediaRefresh();
      // Lets anything holding a media URL rebuild it with the fresh token.
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('cc:media-token'));
    } catch {
      /* not fatal — media just won't load until a token is available; retry soon */
      if (mediaToken) {
        clearTimeout(mediaRefreshTimer);
        mediaRefreshTimer = setTimeout(() => ensureMediaToken(true), 60_000);
      }
    } finally {
      mediaInFlight = null;
    }
    return mediaToken;
  })();
  return mediaInFlight;
}

export function clearMediaToken() {
  mediaToken = null;
  mediaTokenExp = 0;
  clearTimeout(mediaRefreshTimer);
  mediaRefreshTimer = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mediaTokenStale()) ensureMediaToken(true);
  });
}

/** Upload one or more files (multipart) → returns [{ url, name, size, mime }]. */
/** Mirrors server/middleware/upload.js — keep the three in step. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_NOTE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UPLOAD_FILES = 10;
const ALLOWED_UPLOAD_EXT = /\.(jpeg|jpg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|m4a|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|txt)$/i;

const prettyMB = (b) => `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * Validate BEFORE uploading.
 *
 * Without this an oversized file was streamed in full and only then refused —
 * and because the server aborts the request mid-stream, the browser often sees a
 * reset connection rather than the 413, so the user got "upload failed" with no
 * reason after waiting through the whole transfer. Checking locally is instant
 * and gives the real reason. The server still enforces all of this; this is UX,
 * not security.
 */
export function assertUploadable(files, { type } = {}) {
  if (!files.length) throw new Error('No file selected.');
  if (files.length > MAX_UPLOAD_FILES) {
    throw new Error(`Too many files — ${MAX_UPLOAD_FILES} at a time.`);
  }
  for (const f of files) {
    if (type === 'videoNote' && f.size > MAX_VIDEO_NOTE_UPLOAD_BYTES) {
      throw new Error('Video note is too large. Video notes can be up to 10 MB.');
    }
    if (/\.(jpeg|jpg|png|gif|webp)$/i.test(f.name || '') && f.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error(`"${f.name}" is too large. Images can be up to 10 MB.`);
    }
    const limit = /\.(jpeg|jpg|png|gif|webp)$/i.test(f.name || '') ? MAX_IMAGE_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    if (f.size > limit) {
      throw new Error(`"${f.name}" is ${prettyMB(f.size)} — the limit is ${prettyMB(limit)}.`);
    }
    if (f.size === 0) throw new Error(`"${f.name}" is empty.`);
    if (!ALLOWED_UPLOAD_EXT.test(f.name || '')) {
      throw new Error(`"${f.name}" isn't a supported file type.`);
    }
  }
}

export async function uploadFiles(files, options = {}) {
  const list = [...files];
  assertUploadable(list, options);
  const form = new FormData();
  list.forEach((f) => form.append('files', f));
  const { data } = await api.post('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    ...(options.type === 'videoNote' ? { params: { type: 'videoNote' } } : {}),
  });
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
  if (mediaTokenStale()) ensureMediaToken(true); // renew in the background
  return `${base}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(mediaToken)}`;
}

export default api;
