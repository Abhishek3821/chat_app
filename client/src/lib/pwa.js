/**
 * PWA install helper. Browsers fire `beforeinstallprompt` when the app is
 * installable (manifest + service worker + engagement heuristics). We stash the
 * event so the UI can trigger the native install dialog from a button, and
 * expose a tiny subscription so components can show/hide that button reactively.
 */
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(canInstall()));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // suppress the mini-infobar; we drive install from our button
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
}

/** True when the app can be installed AND isn't already running installed. */
export function canInstall() {
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
  return !!deferredPrompt && !standalone;
}

/** Trigger the native install prompt. Returns 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome;
}

/** Subscribe to install-availability changes. Returns an unsubscribe fn. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
