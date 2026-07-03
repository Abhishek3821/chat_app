import { create } from 'zustand';

const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('cc_theme') : null;

/** Global UI state: theme, layout panels, active modal & active call. */
export const useUI = create((set, get) => ({
  theme: storedTheme || 'dark',
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
