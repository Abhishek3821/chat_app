import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';
import { STATUS_FEED } from '../lib/demoData';
import { useAuth } from './useAuth';

/**
 * Status / stories. Real mode uses /api/status; demo mode keeps an in-memory
 * feed so posting a status actually shows up (the old page was static).
 */
export const useStatus = create((set, get) => ({
  feed: [],
  loading: false,

  load: async () => {
    const me = useAuth.getState().user;
    if (DEMO_MODE) {
      // Preserve any statuses posted this session (entries flagged isMe).
      const posted = get().feed.find((e) => e.isMe);
      set({ feed: posted ? [posted, ...STATUS_FEED.filter((e) => !e.isMe)] : STATUS_FEED });
      return;
    }
    // Skeleton only on the first load — live refreshes (socket status-updated)
    // must not blank the visible feed.
    if (get().feed.length === 0) set({ loading: true });
    try {
      const { data } = await api.get('/status');
      const feed = (data.feed || []).map((e) => ({
        ...e,
        isMe: String(e.user._id) === String(me?._id),
      }));
      // Put my own status first.
      feed.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));
      set({ feed });
    } finally {
      set({ loading: false });
    }
  },

  post: async ({ content, background, type = 'text', media = '' }) => {
    const me = useAuth.getState().user;
    if (DEMO_MODE) {
      const item = { _id: `s-${Date.now()}`, type, content, media, background, createdAt: new Date().toISOString(), viewers: [] };
      set((s) => {
        const mine = s.feed.find((e) => e.isMe);
        if (mine) {
          return { feed: s.feed.map((e) => (e.isMe ? { ...e, items: [item, ...e.items] } : e)) };
        }
        return { feed: [{ user: me, isMe: true, items: [item] }, ...s.feed] };
      });
      return;
    }
    await api.post('/status', { content, background, type, media });
    await get().load();
  },

  view: async (statusId) => {
    if (DEMO_MODE || !statusId) return;
    try {
      await api.post(`/status/${statusId}/view`);
    } catch {
      /* ignore */
    }
  },

  /** Optimistically mark a user's whole story as seen (moves it to "Viewed"). */
  markSeen: (userId) =>
    set((s) => ({ feed: s.feed.map((e) => (String(e.user?._id) === String(userId) ? { ...e, seenAll: true } : e)) })),
}));
