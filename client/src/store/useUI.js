import { create } from 'zustand';
import toast from 'react-hot-toast';
// Circular with useAuth (it imports useUI) — safe: only dereferenced inside actions.
import { useAuth } from './useAuth';

const THEME_KEY = 'cc_theme';
// Key is versioned: the pre-rebrand key held 'indigo' for anyone who had used the
// app before, which pinned them to the old accent and hid the new palette
// entirely. Bumping it retires those values instead of migrating them.
const ACCENT_KEY = 'cc_accent_v2';
// Which account the saved look belongs to. Without this we can't tell "this
// user's own choice, made on this device" from "whatever the previous user on
// this browser left behind" — and that distinction is the whole fix below.
const OWNER_KEY = 'cc_appearance_owner';

const read = (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null);
const write = (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); };
const drop = (k) => { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); };

const storedTheme = read(THEME_KEY);
const storedAccent = read(ACCENT_KEY);

/** Accent presets — keep in sync with the [data-accent] blocks in index.css.
 *  'teal' is the brand palette and the :root default, so it has no
 *  [data-accent] block of its own — it's what you get by falling through. */
export const ACCENTS = [
  { id: 'teal', name: 'Teal', dot: '#2d5652' },
  { id: 'indigo', name: 'Indigo', dot: '#6366f1' },
  { id: 'violet', name: 'Violet', dot: '#8b5cf6' },
  { id: 'cyan', name: 'Cyan', dot: '#06b6d4' },
  { id: 'emerald', name: 'Emerald', dot: '#10b981' },
  { id: 'rose', name: 'Rose', dot: '#f43f5e' },
  { id: 'amber', name: 'Amber', dot: '#f59e0b' },
];
const ACCENT_IDS = ACCENTS.map((a) => a.id);

/** Record which account a deliberate appearance change belongs to. */
function stampOwner() {
  const id = useAuth.getState?.()?.user?._id;
  if (id) write(OWNER_KEY, String(id));
}

/** Global UI state: theme, accent, layout panels, active modal & active call. */
export const useUI = create((set, get) => ({
  theme: storedTheme || 'dark',
  accent: ACCENT_IDS.includes(storedAccent) ? storedAccent : 'teal',
  navCollapsed: false,
  chatListOpen: true, // mobile: whether the chat list (vs. conversation) is shown
  rightPanelOpen: false,
  activeModal: null, // 'newChat' | 'createGroup' | 'scheduleMeeting' | 'editProfile' | 'newStatus' | 'profile'
  modalData: null,
  call: null, // { type, peer|group, direction: 'incoming'|'outgoing' }

  setTheme: (theme) => {
    write(THEME_KEY, theme);
    stampOwner();
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  setAccent: (accent) => {
    if (!ACCENT_IDS.includes(accent)) return;
    write(ACCENT_KEY, accent);
    stampOwner();
    set({ accent });
  },

  /**
   * Reconcile this browser's saved look with the account's, once the user loads.
   *
   * The old rule was "the account always wins", applied on every page load — and
   * it also rewrote localStorage with the account's value. So the moment the
   * server copy was stale for ANY reason (a save that failed, a change made
   * while offline, or a wipe from a transient 401) your choice was discarded on
   * every single refresh and could never recover. That is the reported bug.
   *
   * New rule: the last choice made ON THIS DEVICE BY THIS USER wins. The
   * account's value is adopted only when this device holds nothing for this
   * user — a fresh browser, or a different account signing in, which is what
   * still stops one user's look from leaking onto the next.
   */
  hydrateAppearance: (userId, settings = {}) => {
    if (!userId) return;
    const mine = String(read(OWNER_KEY) || '') === String(userId);
    const localTheme = read(THEME_KEY);
    const localAccent = read(ACCENT_KEY);

    if (mine && (localTheme || localAccent)) {
      set({
        theme: localTheme || get().theme,
        accent: ACCENT_IDS.includes(localAccent) ? localAccent : get().accent,
      });
      return;
    }

    const theme = settings.theme || 'dark';
    const accent = ACCENT_IDS.includes(settings.accent) ? settings.accent : 'teal';
    write(THEME_KEY, theme);
    write(ACCENT_KEY, accent);
    write(OWNER_KEY, String(userId));
    set({ theme, accent });
  },

  /** On logout, drop the previous user's look so it never lingers on the shared
   *  browser (login/splash screens) or leaks onto the next user before they hydrate.
   *  Deliberately NOT called for a transient 401 — see forceLogout in useAuth. */
  resetAppearance: () => {
    drop(THEME_KEY);
    drop(ACCENT_KEY);
    drop(OWNER_KEY);
    set({ theme: 'dark', accent: 'teal' });
  },

  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanel: (rightPanelOpen) => set({ rightPanelOpen }),
  setChatListOpen: (chatListOpen) => set({ chatListOpen }),

  openModal: (activeModal, modalData = null) => set({ activeModal, modalData }),
  closeModal: () => set({ activeModal: null, modalData: null }),

  startCall: (call) => {
    // You can't call yourself: block an outgoing 1:1 call whose target is the
    // signed-in user (the server rejects it too — this keeps the UI honest).
    if (call?.direction === 'outgoing' && !call?.group) {
      const meId = useAuth.getState()?.user?._id;
      if (meId && call?.peer?._id && String(call.peer._id) === String(meId)) {
        toast.error("You can't call yourself.");
        return;
      }
    }
    set({ call: { minimized: false, ...call } });
  },
  endCall: () => set({ call: null }),

  // True while the user is inside a meeting room — incoming calls are then
  // answered with "busy" and surfaced as a side notification instead of ringing.
  inMeeting: false,
  setInMeeting: (inMeeting) => set({ inMeeting }),

  // Someone called while we were busy (in a call or meeting). Rendered by
  // BusyCallBanner as a dismissible side notification.
  busyIncoming: null, // { caller, type, at }
  showBusyIncoming: (busyIncoming) => set({ busyIncoming }),
  dismissBusyIncoming: () => set({ busyIncoming: null }),
  // Minimize keeps the call ALIVE (media + peer connection) — the overlay just
  // collapses to a floating pill so the user can browse/chat during the call.
  minimizeCall: () => set((s) => (s.call ? { call: { ...s.call, minimized: true } } : {})),
  restoreCall: () => set((s) => (s.call ? { call: { ...s.call, minimized: false } } : {})),
}));
