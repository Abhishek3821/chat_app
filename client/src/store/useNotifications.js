import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';
import { NOTIFICATIONS } from '../lib/demoData';

let seq = 0;

/**
 * Notification bell state. Hydrated once from /api/notifications (persisted
 * message notifications), then updated live from socket events via pushLocal().
 * Loading only happens on mount, so live + persisted never double up in a session.
 */
export const useNotifications = create((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    if (DEMO_MODE) return set({ items: NOTIFICATIONS, loaded: true });
    try {
      const { data } = await api.get('/notifications');
      set({ items: data.notifications || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  /** Prepend a real-time notification (from a socket event). */
  pushLocal: (n) =>
    set((s) => ({
      items: [
        { _id: `live-${Date.now()}-${seq++}`, isRead: false, createdAt: new Date().toISOString(), ...n },
        ...s.items,
      ].slice(0, 50),
    })),

  /** Mark ONE notification read (clicking it). Live (`live-…`) ids are local-only. */
  markRead: async (id) => {
    set((s) => ({ items: s.items.map((n) => (n._id === id ? { ...n, isRead: true } : n)) }));
    if (!DEMO_MODE && !String(id).startsWith('live-')) {
      try {
        await api.patch(`/notifications/${id}/read`);
      } catch {
        /* optimistic state stands */
      }
    }
  },

  markAllRead: async () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, isRead: true })) }));
    if (!DEMO_MODE) {
      try {
        await api.patch('/notifications/read');
      } catch {
        /* ignore */
      }
    }
  },
}));
