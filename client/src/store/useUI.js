import { create } from 'zustand';

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

  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanel: (rightPanelOpen) => set({ rightPanelOpen }),
  setChatListOpen: (chatListOpen) => set({ chatListOpen }),

  openModal: (activeModal, modalData = null) => set({ activeModal, modalData }),
  closeModal: () => set({ activeModal: null, modalData: null }),

  startCall: (call) => set({ call: { minimized: false, ...call } }),
  endCall: () => set({ call: null }),
  // Minimize keeps the call ALIVE (media + peer connection) — the overlay just
  // collapses to a floating pill so the user can browse/chat during the call.
  minimizeCall: () => set((s) => (s.call ? { call: { ...s.call, minimized: true } } : {})),
  restoreCall: () => set((s) => (s.call ? { call: { ...s.call, minimized: false } } : {})),
}));
