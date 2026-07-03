import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';

/** Developer API keys (manage your own). Real mode only — needs the backend. */
export const useApiKeys = create((set, get) => ({
  keys: [],
  scopes: [],
  loading: false,

  load: async () => {
    if (DEMO_MODE) return;
    set({ loading: true });
    try {
      const { data } = await api.get('/keys');
      set({ keys: data.keys || [], scopes: data.availableScopes || [] });
    } finally {
      set({ loading: false });
    }
  },

  /** Create a key → returns the plaintext secret (shown once), then refreshes the list. */
  create: async (label, scopes) => {
    const { data } = await api.post('/keys', { label, scopes });
    await get().load();
    return data.key;
  },

  revoke: async (id) => {
    await api.delete(`/keys/${id}`);
    set((s) => ({ keys: s.keys.filter((k) => k.id !== id) }));
  },
}));
