/**
 * Invite links — the payload behind every QR code.
 *
 * Shape mirrors the routes registered in App.jsx:
 *   /invite/g/:code   group, keyed by Chat.inviteCode
 *   /invite/u/:code   person, keyed by username
 */

const base = () => (typeof window !== 'undefined' ? window.location.origin : '');

export const inviteUrlForGroup = (inviteCode) =>
  inviteCode ? `${base()}/invite/g/${encodeURIComponent(inviteCode)}` : '';

export const inviteUrlForUser = (username) =>
  username ? `${base()}/invite/u/${encodeURIComponent(String(username).replace(/^@/, ''))}` : '';

/**
 * Turn scanned/pasted text into an in-app path, or null if it isn't ours.
 *
 * Accepts a full URL, a bare path, or just the code itself — people paste all
 * three. Deliberately strict about the host: a QR is untrusted input, and
 * following an `/invite/...` path from someone else's origin would let a foreign
 * code drive our join flow. Anything off-origin is rejected rather than coerced.
 */
export function parseInvite(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Full URL — must be same-origin.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (base() && u.origin !== base()) return null;
      return matchPath(u.pathname);
    } catch {
      return null;
    }
  }

  // Bare path.
  if (raw.startsWith('/')) return matchPath(raw);

  // Bare code: treat as a group invite code (that's the shareable one users copy).
  if (/^[A-Za-z0-9_-]{4,64}$/.test(raw)) return `/invite/g/${encodeURIComponent(raw)}`;

  return null;
}

function matchPath(pathname) {
  const m = /^\/invite\/(g|u)\/([A-Za-z0-9_.@-]{1,64})\/?$/.exec(pathname || '');
  return m ? `/invite/${m[1]}/${m[2]}` : null;
}
