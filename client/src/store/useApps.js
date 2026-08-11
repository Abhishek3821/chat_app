import { create } from 'zustand';
import api from '../lib/api';

/**
 * Embeddable-platform tenants ("Apps") for the admin console.
 *
 * The plaintext app secret exists ONLY in the response that created or rotated
 * it — the server stores a hash. So it is held here in memory, keyed by app id,
 * and deliberately never persisted: writing it to localStorage would undo the
 * point of hashing it server-side.
 */
export const useApps = create((set, get) => ({
  apps: [],
  loading: false,
  stats: {}, // appId -> live counts
  revealedSecrets: {}, // appId -> plaintext, in memory for this page view only

  load: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get('/apps');
      set({ apps: data.apps || [] });
    } finally {
      set({ loading: false });
    }
  },

  create: async ({ name, features }) => {
    const { data } = await api.post('/apps', { name, features });
    set((s) => ({
      apps: [data.app, ...s.apps],
      revealedSecrets: { ...s.revealedSecrets, [data.app._id]: data.secret },
    }));
    return data;
  },

  update: async (id, patch) => {
    const { data } = await api.patch(`/apps/${id}`, patch);
    set((s) => ({ apps: s.apps.map((a) => (a._id === id ? data.app : a)) }));
    return data.app;
  },

  /** Toggle one capability without clobbering the others. */
  toggleFeature: async (id, feature) => {
    const app = get().apps.find((a) => a._id === id);
    if (!app) return null;
    const has = (app.features || []).includes(feature);
    const features = has ? app.features.filter((f) => f !== feature) : [...(app.features || []), feature];
    return get().update(id, { features });
  },

  rotate: async (id) => {
    const { data } = await api.post(`/apps/${id}/rotate`);
    set((s) => ({
      revealedSecrets: { ...s.revealedSecrets, [id]: data.secret },
      apps: s.apps.map((a) => (a._id === id ? { ...a, secretPrefix: data.secretPrefix, secretRotatedAt: new Date().toISOString() } : a)),
    }));
    return data.secret;
  },

  disable: async (id) => {
    await api.delete(`/apps/${id}`);
    set((s) => ({ apps: s.apps.map((a) => (a._id === id ? { ...a, active: false } : a)) }));
  },

  loadStats: async (id) => {
    const { data } = await api.get(`/apps/${id}/stats`);
    set((s) => ({ stats: { ...s.stats, [id]: data.stats } }));
    return data.stats;
  },

  dismissSecret: (id) =>
    set((s) => {
      const next = { ...s.revealedSecrets };
      delete next[id];
      return { revealedSecrets: next };
    }),
}));
