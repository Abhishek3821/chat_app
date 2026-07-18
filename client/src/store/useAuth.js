import { create } from 'zustand';
import api, { DEMO_MODE, ensureMediaToken, clearMediaToken } from '../lib/api';
import { ME } from '../lib/demoData';
import { useUI } from './useUI';

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

  /**
   * Step 1 of sign-in. `identifier` may be an email, username or phone number.
   * Returns the raw response: either { requiresOtp: true, channel, sentTo, … }
   * (finish with verifyLoginOtp) or a full session when OTP is disabled.
   */
  login: async ({ identifier, email, password }) => {
    if (DEMO_MODE) {
      localStorage.setItem('cc_demo_authed', '1');
      set({ user: ME });
      return { user: ME };
    }
    const id = identifier ?? email;
    const { data } = await api.post('/auth/login', { identifier: id, email: id, password });
    if (data.requiresOtp) return data; // OTP step comes next — no session yet
    if (data.token) localStorage.setItem('cc_token', data.token);
    sessionStorage.setItem('cc_unlocked', '1'); // just authenticated — don't re-prompt for the PIN
    set({ user: data.user });
    ensureMediaToken(true);
    return data;
  },

  /** Step 2 of sign-in: verify the OTP that was sent to the phone/email. */
  verifyLoginOtp: async ({ identifier, otp }) => {
    if (DEMO_MODE) {
      localStorage.setItem('cc_demo_authed', '1');
      set({ user: ME });
      return ME;
    }
    const { data } = await api.post('/auth/login/verify-otp', { identifier, otp });
    if (data.token) localStorage.setItem('cc_token', data.token);
    sessionStorage.setItem('cc_unlocked', '1');
    set({ user: data.user });
    ensureMediaToken(true);
    return data.user;
  },

  /** Resend the login OTP (needs the password again — anti-abuse). */
  resendLoginOtp: async ({ identifier, password }) => {
    if (DEMO_MODE) return {};
    const { data } = await api.post('/auth/login/resend-otp', { identifier, password });
    return data; // may include devOtp when no SMS/email is configured
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

  // Sign in / up with a Google ID token (from Google Identity Services). The
  // server verifies it and returns our own session, so it behaves like login.
  googleAuth: async (credential) => {
    const { data } = await api.post('/auth/google', { credential });
    if (data.token) localStorage.setItem('cc_token', data.token);
    sessionStorage.setItem('cc_unlocked', '1');
    set({ user: data.user });
    ensureMediaToken(true);
    return data.user;
  },

  verifyOtp: async ({ email, otp }) => {
    if (DEMO_MODE) {
      localStorage.setItem('cc_demo_authed', '1');
      set({ user: ME });
      return ME;
    }
    const { data } = await api.post('/auth/verify-otp', { email, otp });
    if (data.token) localStorage.setItem('cc_token', data.token);
    sessionStorage.setItem('cc_unlocked', '1');
    set({ user: data.user });
    ensureMediaToken(true);
    return data.user;
  },

  resendOtp: async (email) => {
    if (DEMO_MODE) return {};
    const { data } = await api.post('/auth/resend-otp', { email });
    return data; // may include devOtp when email isn't configured
  },

  /** Request a password-reset email. Server always responds success (no email enumeration). */
  forgotPassword: async (email) => {
    if (DEMO_MODE) return { success: true };
    const { data } = await api.post('/auth/forgot-password', { email });
    return data;
  },

  /** Complete a password reset with the emailed token. Logs the user straight in. */
  resetPassword: async (token, password) => {
    if (DEMO_MODE) return { success: true };
    const { data } = await api.post(`/auth/reset-password/${token}`, { password });
    if (data.token) localStorage.setItem('cc_token', data.token);
    if (data.user) set({ user: data.user });
    if (data.user) ensureMediaToken(true);
    return data;
  },

  /** Change password while logged in. Server re-issues a token for THIS session. */
  changePassword: async ({ currentPassword, newPassword }) => {
    if (DEMO_MODE) return { success: true };
    const { data } = await api.patch('/auth/change-password', { currentPassword, newPassword });
    if (data.token) localStorage.setItem('cc_token', data.token);
    return data;
  },

  /** Permanently delete the account and all its data, then tear down the session. */
  deleteAccount: async () => {
    if (!DEMO_MODE) await api.delete('/users/me');
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_demo_authed');
    clearMediaToken();
    useUI.getState().resetAppearance();
    set({ user: null });
  },

  updateUser: (patch) => set((s) => ({ user: { ...s.user, ...patch } })),

  /** Persist profile changes (name, username, bio, avatar) to the backend. */
  updateProfile: async (updates) => {
    if (DEMO_MODE) {
      set((s) => ({ user: { ...s.user, ...updates } }));
      return get().user;
    }
    const { data } = await api.patch('/users/me', updates);
    set({ user: data.user });
    return data.user;
  },

  /** Persist per-user preferences (theme, accent, notifications…) to the account,
   *  so each user's look follows THEIR login — never shared across users/devices. */
  updateSettings: async (updates) => {
    if (DEMO_MODE) {
      set((s) => ({ user: { ...s.user, settings: { ...(s.user?.settings || {}), ...updates } } }));
      return get().user?.settings;
    }
    const { data } = await api.patch('/users/me/settings', updates);
    set((s) => ({ user: { ...s.user, settings: data.settings } }));
    return data.settings;
  },

  /** Download a JSON archive of the account's data. */
  exportMyData: async () => {
    if (DEMO_MODE) return;
    const res = await api.get('/users/me/export', { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chatconnect-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ── Two-step verification (app-lock PIN) ──
  enableTwoStep: async (pin) => {
    await api.post('/auth/two-step/enable', { pin });
    set((s) => ({ user: { ...s.user, twoStepEnabled: true } }));
    sessionStorage.setItem('cc_unlocked', '1'); // enabling counts as unlocked now
  },
  disableTwoStep: async (pin) => {
    await api.post('/auth/two-step/disable', { pin });
    set((s) => ({ user: { ...s.user, twoStepEnabled: false } }));
  },
  verifyTwoStep: async (pin) => {
    await api.post('/auth/two-step/verify', { pin });
    sessionStorage.setItem('cc_unlocked', '1');
  },
  /** Forgot PIN → email an OTP to the account address. */
  requestTwoStepReset: async () => {
    const { data } = await api.post('/auth/two-step/forgot');
    return data; // { message, email, devOtp? }
  },
  /** Verify the emailed OTP and set a new PIN. Unlocks this session. */
  resetTwoStepPin: async ({ otp, pin }) => {
    const { data } = await api.post('/auth/two-step/reset', { otp, pin });
    sessionStorage.setItem('cc_unlocked', '1'); // email ownership proven — unlock
    return data;
  },

  // ── Active sessions / devices (secure session handling) ──
  listSessions: async () => {
    if (DEMO_MODE) return [];
    const { data } = await api.get('/auth/sessions');
    return data.sessions || [];
  },
  revokeSession: async (id) => {
    await api.delete(`/auth/sessions/${id}`);
  },
  revokeOtherSessions: async () => {
    await api.post('/auth/sessions/revoke-others');
  },

  /** Local-only session teardown (used when the API says our token is dead). */
  forceLogout: () => {
    sessionStorage.removeItem('cc_unlocked');
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_demo_authed');
    clearMediaToken();
    useUI.getState().resetAppearance(); // don't leave this user's look on the browser
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
    sessionStorage.removeItem('cc_unlocked');
    clearMediaToken();
    useUI.getState().resetAppearance(); // don't leave this user's look on the browser
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
