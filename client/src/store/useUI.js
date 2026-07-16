import { create } from 'zustand';
import toast from 'react-hot-toast';
// Circular with useAuth (it imports useUI) — safe: only dereferenced inside actions.
import { useAuth } from './useAuth';

const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('cc_theme') : null;
const storedAccent = typeof localStorage !== 'undefined' ? localStorage.getItem('cc_accent') : null;

/** Accent presets — keep in sync with the [data-accent] blocks in index.css. */
export const ACCENTS = [
  { id: 'indigo', name: 'Indigo', dot: '#6366f1' },
  { id: 'violet', name: 'Violet', dot: '#8b5cf6' },
  { id: 'cyan', name: 'Cyan', dot: '#06b6d4' },
  { id: 'emerald', name: 'Emerald', dot: '#10b981' },
  { id: 'rose', name: 'Rose', dot: '#f43f5e' },
  { id: 'amber', name: 'Amber', dot: '#f59e0b' },
];
const ACCENT_IDS = ACCENTS.map((a) => a.id);

/** Global UI state: theme, accent, layout panels, active modal & active call. */
export const useUI = create((set, get) => ({
  theme: storedTheme || 'dark',
  accent: ACCENT_IDS.includes(storedAccent) ? storedAccent : 'indigo',
  navCollapsed: false,
  chatListOpen: true, // mobile: whether the chat list (vs. conversation) is shown
  rightPanelOpen: false,
  activeModal: null, // 'newChat' | 'createGroup' | 'scheduleMeeting' | 'editProfile' | 'newStatus' | 'profile'
  modalData: null,
  call: null, // { type, peer|group, direction: 'incoming'|'outgoing' }

  setTheme: (theme) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('cc_theme', theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  setAccent: (accent) => {
    if (!ACCENT_IDS.includes(accent)) return;
    if (typeof localStorage !== 'undefined') localStorage.setItem('cc_accent', accent);
    set({ accent });
  },

  /** On logout, drop the previous user's look so it never lingers on the shared
   *  browser (login/splash screens) or leaks onto the next user before they hydrate. */
  resetAppearance: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('cc_theme');
      localStorage.removeItem('cc_accent');
    }
    set({ theme: 'dark', accent: 'indigo' });
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
