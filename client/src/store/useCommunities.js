import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';
import { isFresh, markFetched, markStale } from '../lib/freshness';

/** Communities: groups-of-groups with an admins-only announcement group. */
export const useCommunities = create((set, get) => ({
  communities: [],
  active: null, // full detail (with groups) of the open community
  loading: false,

  load: async ({ force = false } = {}) => {
    if (DEMO_MODE) return;
    // The page refetches on every mount; skip it if we just did. Writes below
    // call markStale('communities'), so this never hides the user's own changes.
    if (!force && isFresh('communities') && get().communities.length) return;
    set({ loading: true });
    try {
      const { data } = await api.get('/communities');
      set({ communities: data.communities || [] });
      markFetched('communities');
    } catch {
      markStale('communities'); // a failed load must not look fresh
    } finally {
      set({ loading: false });
    }
  },

  open: async (id) => {
    const { data } = await api.get(`/communities/${id}`);
    set({ active: data.community });
    return data.community;
  },

  create: async ({ name, description }) => {
    const { data } = await api.post('/communities', { name, description });
    set((s) => ({ communities: [data.community, ...s.communities] }));
    return data.community;
  },

  join: async (inviteCode) => {
    const { data } = await api.post(`/communities/join/${encodeURIComponent(inviteCode)}`);
    await get().load({ force: true }); // must not be skipped by the freshness guard
    return data.community;
  },

  addGroup: async (id, name) => {
    const { data } = await api.post(`/communities/${id}/groups`, { name });
    if (get().active?._id === id) await get().open(id);
    return data.chat;
  },

  leave: async (id) => {
    await api.post(`/communities/${id}/leave`);
    set((s) => ({ communities: s.communities.filter((c) => c._id !== id), active: s.active?._id === id ? null : s.active }));
  },
}));
