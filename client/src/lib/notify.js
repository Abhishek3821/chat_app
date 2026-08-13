/**
 * Desktop notifications + unread badges, WhatsApp-style.
 *
 * Three surfaces, one source of truth:
 *   - an OS notification per chat (replaced in place as more messages arrive),
 *   - the tab title prefix "(3) ChatKonect …",
 *   - the OS/taskbar app badge where supported (installed PWA).
 *
 * Everything here is best-effort — a browser that blocks or lacks notifications
 * must never break message delivery, so all calls swallow their errors.
 */
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';

const BASE_TITLE = 'ChatKonect — Talk, meet & connect';

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Ask for notification permission. Browsers require a user gesture in practice,
 * so this is called from an explicit opt-in, never on page load.
 */
async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Prompt for notification permission on the user's next click.
 * Chrome/Safari reject requestPermission() outside a user gesture, so it can't
 * simply be called on mount. Returns a detach function.
 */
export function askPermissionOnFirstGesture() {
  if (!notificationsSupported() || Notification.permission !== 'default') return () => {};
  const on = () => requestNotificationPermission();
  window.addEventListener('pointerdown', on, { once: true });
  window.addEventListener('keydown', on, { once: true });
  return () => {
    window.removeEventListener('pointerdown', on);
    window.removeEventListener('keydown', on);
  };
}

/** Is the user looking at the app right now? */
function appIsFocused() {
  return typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * Should this message alert the user at all? Honours do-not-disturb, the
 * message/group notification prefs, and per-chat mute. Shared by the OS
 * notification and the sound so a muted chat is silent on both.
 */
export function messageAlertsAllowed({ isGroup, chatId } = {}) {
  const user = useAuth.getState().user;
  if (!user) return false;
  if (user.presenceState === 'dnd') return false;
  const n = user.settings?.notifications || {};
  if (isGroup ? n.groups === false : n.messages === false) return false;
  if (chatId && useChat.getState().chats.find((c) => c._id === chatId)?.muted) return false;
  return true;
}

/** Raster, not the SVG logo: Chrome silently refuses to render an SVG as a
 *  notification icon and falls back to a generic browser glyph. */
const APP_ICON = '/icon-192.png';

/**
 * Show an OS notification for an incoming message, WhatsApp-style.
 *
 * Skipped while the app is focused — the in-app chat/bell already shows it, and
 * a duplicate OS toast over a visible window is what makes web chat apps feel
 * noisy. `tag` is per-chat so a burst from one person collapses into a single
 * notification instead of stacking ten, and the body then leads with the count
 * ("3 new messages") the way WhatsApp does rather than silently replacing the
 * previous text.
 *
 * Shown through the SERVICE WORKER wherever one is registered. That is not a
 * stylistic choice: Chrome on Android does not implement the `Notification`
 * constructor at all — `new Notification()` throws "Illegal constructor" there,
 * and because every call here is wrapped in a swallow-everything try/catch, the
 * failure was completely silent. Mobile users were getting NO notifications.
 * The constructor path is kept only as a desktop fallback for the brief window
 * before the worker is ready.
 */
export async function notifyMessage({ chatId, title, body, icon, isGroup }) {
  try {
    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    if (appIsFocused()) return;
    if (!messageAlertsAllowed({ isGroup, chatId })) return;

    // Unread for THIS chat, so a burst reads as "N new messages" instead of the
    // notification quietly swapping its text each time.
    const unread = useChat.getState().chats.find((c) => c._id === chatId)?.unreadCount || 0;
    const heading = title || 'New message';
    const options = {
      body: unread > 1 ? `${unread} new messages · ${body || ''}`.trim() : body || '',
      icon: icon || APP_ICON,
      badge: APP_ICON,
      tag: `cc-chat-${chatId}`,
      renotify: true,
      vibrate: [90, 40, 90],
      timestamp: Date.now(),
      // Consumed by the worker's notificationclick handler, so a click lands in
      // the right conversation whether the app was open or closed.
      data: { chatId, url: chatId ? `/?chat=${chatId}` : '/' },
    };

    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) {
      await reg.showNotification(heading, options);
      return;
    }

    const n = new Notification(heading, options);
    n.onclick = () => {
      try {
        window.focus();
        if (chatId) useChat.getState().setActiveChat(chatId);
      } catch { /* focus is best-effort */ }
      n.close();
    };
    setTimeout(() => n.close(), 12_000);
  } catch { /* notifications are best-effort */ }
}

/** Total unread across all chats. */
function totalUnread() {
  return useChat.getState().chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
}

let lastBadgeCount = -1;

/**
 * Mirror the unread count into the tab title and the OS app badge, so an
 * unfocused tab still shows there's something waiting. Bails when the count
 * hasn't moved, since this runs on every chat-store change.
 */
function syncUnreadBadge() {
  const count = totalUnread();
  if (count === lastBadgeCount) return;
  lastBadgeCount = count;
  try {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  } catch { /* ignore */ }
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch { /* badge API is optional */ }
}

/**
 * Track the unread total for the lifetime of the page. Subscribed globally
 * rather than from a component so the badge stays correct on routes that render
 * outside the app shell (e.g. /meet/:code).
 */
export function initUnreadBadge() {
  syncUnreadBadge();
  useChat.subscribe(syncUnreadBadge);
}
