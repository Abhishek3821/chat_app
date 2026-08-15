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
 * Accepts a full URL, a bare path, `@username`, or just the code — people
 * arrive with all four.
 *
 * HOST IS IGNORED, on purpose. This used to demand an exact origin match, which
 * rejected the app's OWN codes in every situation that matters: a QR minted on
 * `www.` scanned from the apex domain (or the reverse), anything scanned while
 * developing on localhost, and every preview deployment. The Scan button
 * answered "That doesn't look like a ChatKonect invite" for a perfectly valid
 * ChatKonect invite.
 *
 * That check was not buying safety either. The ONLY thing taken from the text is
 * the code in the path; we then navigate to OUR OWN `/invite/...` route with it
 * and never follow the scanned URL. A hostile QR claiming some other host can
 * therefore do exactly one thing — hand us a code — which is identical to a
 * person reading a code out loud. The path shape below is the real gate.
 */
export function parseInvite(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Full URL — any host; only the path shape has to be ours.
  if (/^https?:\/\//i.test(raw)) {
    try {
      return matchPath(new URL(raw).pathname);
    } catch {
      return null;
    }
  }

  // Bare path.
  if (raw.startsWith('/')) return matchPath(raw);

  // "@username" — what the Contacts screen tells people their handle looks like.
  if (/^@[A-Za-z0-9_.]{3,30}$/.test(raw)) return `/invite/u/${encodeURIComponent(raw.slice(1))}`;

  // Bare code: treat as a group invite code (that's the shareable one users copy).
  if (/^[A-Za-z0-9_-]{4,64}$/.test(raw)) return `/invite/g/${encodeURIComponent(raw)}`;

  return null;
}

function matchPath(pathname) {
  const m = /^\/invite\/(g|u)\/([A-Za-z0-9_.@-]{1,64})\/?$/.exec(pathname || '');
  return m ? `/invite/${m[1]}/${m[2]}` : null;
}
