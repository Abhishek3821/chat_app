import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';

/** Communities: groups-of-groups with an admins-only announcement group. */
export const useCommunities = create((set, get) => ({
  communities: [],
  active: null, // full detail (with groups) of the open community
  loading: false,

  load: async () => {
    if (DEMO_MODE) return;
    set({ loading: true });
    try {
      const { data } = await api.get('/communities');
      set({ communities: data.communities || [] });
    } catch {
      /* offline */
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
    await get().load();
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
