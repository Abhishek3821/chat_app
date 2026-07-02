import { create } from 'zustand';
import api, { DEMO_MODE, ensureMediaToken, clearMediaToken } from '../lib/api';
import { ME } from '../lib/demoData';

export const useAuth = create((set, get) => ({
  user: null,
  loading: true,

  /** Bootstrap the session on app load. */
  init: async () => {
    if (DEMO_MODE) {
      const cached = localStorage.getItem('cc_demo_authed');
      set({ user: cached ? ME : null, loading: false });
      return;
    }
    const token = localStorage.getItem('cc_token');
    if (!token) return set({ user: null, loading: false });
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, loading: false });
      ensureMediaToken();
    } catch {
      localStorage.removeItem('cc_token');
      set({ user: null, loading: false });
    }
  },

  login: async ({ email, password }) => {
    if (DEMO_MODE) {
      localStorage.setItem('cc_demo_authed', '1');
      set({ user: ME });
      return ME;
    }
    const { data } = await api.post('/auth/login', { email, password });
    if (data.token) localStorage.setItem('cc_token', data.token);
    set({ user: data.user });
    ensureMediaToken(true);
    return data.user;
  },

  signup: async (payload) => {
    if (DEMO_MODE) {
      localStorage.setItem('cc_demo_authed', '1');
      set({ user: { ...ME, ...payload } });
      return { user: ME };
    }
    const { data } = await api.post('/auth/signup', payload);
    if (data.token) {
      localStorage.setItem('cc_token', data.token);
      set({ user: data.user });
    }
    return data;
  },

  verifyOtp: async ({ email, otp }) => {
    if (DEMO_MODE) {
      localStorage.setItem('cc_demo_authed', '1');
      set({ user: ME });
      return ME;
    }
    const { data } = await api.post('/auth/verify-otp', { email, otp });
    if (data.token) localStorage.setItem('cc_token', data.token);
    set({ user: data.user });
    ensureMediaToken(true);
    return data.user;
  },

  resendOtp: async (email) => {
    if (DEMO_MODE) return {};
    const { data } = await api.post('/auth/resend-otp', { email });
    return data; // may include devOtp when email isn't configured
  },

  updateUser: (patch) => set((s) => ({ user: { ...s.user, ...patch } })),

  /** Local-only session teardown (used when the API says our token is dead). */
  forceLogout: () => {
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_demo_authed');
    clearMediaToken();
    set({ user: null, loading: false });
  },

  logout: async () => {
    if (!DEMO_MODE) {
      try {
        await api.post('/auth/logout');
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_demo_authed');
    clearMediaToken();
    set({ user: null });
  },
}));

// API said 401 on a protected call → the session is gone (expired/revoked).
// Clear auth state; ProtectedRoute redirects to /login automatically.
if (typeof window !== 'undefined') {
  window.addEventListener('cc:unauthorized', () => {
    if (useAuth.getState().user) useAuth.getState().forceLogout();
  });
}
