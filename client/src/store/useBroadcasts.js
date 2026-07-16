import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';

/** Broadcast lists: send one message to many contacts as individual 1:1 chats. */
export const useBroadcasts = create((set) => ({
  lists: [],
  loading: false,

  load: async () => {
    if (DEMO_MODE) return;
    set({ loading: true });
    try {
      const { data } = await api.get('/broadcasts');
      set({ lists: data.lists || [] });
    } catch {
      /* offline */
    } finally {
      set({ loading: false });
    }
  },

  create: async (name, recipients) => {
    const { data } = await api.post('/broadcasts', { name, recipients });
    set((s) => ({ lists: [data.list, ...s.lists] }));
    return data.list;
  },

  update: async (id, body) => {
    const { data } = await api.patch(`/broadcasts/${id}`, body);
    set((s) => ({ lists: s.lists.map((l) => (l._id === id ? data.list : l)) }));
    return data.list;
  },

  remove: async (id) => {
    await api.delete(`/broadcasts/${id}`);
    set((s) => ({ lists: s.lists.filter((l) => l._id !== id) }));
  },

  send: async (id, content) => {
    const { data } = await api.post(`/broadcasts/${id}/send`, { content });
    return data; // { sent, skipped }
  },
}));
