import { IS_EMBED } from './embedSession.js';

// Share a link back to the host page that knows how to mint the user's session.
// The link contains only a UI path; it never contains credentials.
const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
const parentOrigin = params?.get('parentOrigin');
const hostPath = params?.get('hostPath') || '/';
export function integrationLink(to) {
  if (IS_EMBED && parentOrigin) {
    const host = new URL(hostPath, parentOrigin);
    if (host.origin === parentOrigin && /^https?:$/.test(host.protocol)) {
      host.search = '';
      host.hash = '';
      host.searchParams.set('chatkonectPath', to);
      return host.href;
    }
  }
  return `${window.location.origin}${to}`;
}
