// Embedded sessions are supplied by the host and never use first-party cookies.
export const IS_EMBED = typeof window !== 'undefined' && /^\/embed(?:\/|$)/.test(window.location.pathname);

let requestFromHost = null;
let pending = null;
let settle = null;

export function bindEmbedRefresh(request) {
  requestFromHost = request;
  return () => {
    requestFromHost = null;
    completeEmbedRefresh(null);
  };
}

export function completeEmbedRefresh(token) {
  settle?.(token || null);
}

export function requestEmbedRefresh() {
  if (!requestFromHost) return Promise.resolve(null);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const timeout = setTimeout(() => finish(null), 15000);
    const finish = (token) => {
      clearTimeout(timeout);
      settle = null;
      pending = null;
      resolve(token);
    };
    settle = finish;
  });
  const promise = pending;
  try { requestFromHost(); } catch { completeEmbedRefresh(null); }
  return promise;
}

// This reads expiry only to schedule renewal. The API validates the JWT.
export function tokenRefreshDelay(token, fallbackSeconds = 3600, now = Date.now()) {
  let remaining = fallbackSeconds * 1000;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isFinite(payload.exp)) remaining = payload.exp * 1000 - now;
  } catch { /* non-JWT tokens use the server's advertised lifetime */ }
  return Math.max(1000, Math.min(remaining * 0.8, remaining - 30000));
}
