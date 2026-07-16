import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';
import { USERS, CONTACT_REQUESTS } from '../lib/demoData';
import { useChat } from './useChat';

/**
 * Contacts + friend-request flow.
 * Real mode talks to /api/users + /api/contacts; demo mode uses local data so
 * the UI is fully explorable offline.
 */
export const useContacts = create((set, get) => ({
  contacts: [],
  favorites: [],
  incoming: [],
  outgoing: [],
  results: [],
  loading: false,
  searching: false,

  load: async () => {
    if (DEMO_MODE) {
      set((s) => ({
        contacts: USERS,
        favorites: USERS.filter((u) => ['u1', 'u5'].includes(u._id)),
        incoming: CONTACT_REQUESTS.map((r) => ({ _id: r._id, from: r.from, message: r.message })),
        outgoing: s.outgoing, // keep requests sent this session so the "Requested" pill sticks
      }));
      return;
    }
    set({ loading: true });
    try {
      const [{ data: c }, { data: r }] = await Promise.all([
        api.get('/users/me/contacts'),
        api.get('/contacts/requests'),
      ]);
      set({ contacts: c.contacts || [], favorites: c.favorites || [], incoming: r.incoming || [], outgoing: r.outgoing || [] });
    } finally {
      set({ loading: false });
    }
  },

  search: async (q) => {
    const query = q.trim();
    if (!query) return set({ results: [] });
    if (DEMO_MODE) {
      const lc = query.toLowerCase();
      return set({ results: USERS.filter((u) => [u.name, u.username, u.email].some((f) => f?.toLowerCase().includes(lc))) });
    }
    set({ searching: true });
    try {
      const { data } = await api.get('/users/search', { params: { q: query } });
      set({ results: data.users || [] });
    } finally {
      set({ searching: false });
    }
  },

  clearResults: () => set({ results: [] }),

  sendRequest: async (userId, message = '') => {
    if (DEMO_MODE) {
      set((s) =>
        s.outgoing.some((r) => r.to?._id === userId)
          ? {}
          : { outgoing: [...s.outgoing, { _id: `req-${userId}`, to: USERS.find((u) => u._id === userId) }] }
      );
      return;
    }
    await api.post(`/contacts/request/${userId}`, { message });
    await get().load();
  },

  respond: async (requestId, action) => {
    // action: 'accept' | 'reject' — optimistic remove, with rollback on failure.
    const removed = get().incoming.find((r) => r._id === requestId);
    set((s) => ({ incoming: s.incoming.filter((r) => r._id !== requestId) }));
    if (DEMO_MODE) return;
    try {
      await api.patch(`/contacts/request/${requestId}`, { action });
      if (action === 'accept') await get().load();
    } catch (err) {
      if (removed) set((s) => ({ incoming: [removed, ...s.incoming] })); // restore
      throw err;
    }
  },

  toggleFavorite: async (userId) => {
    const isFav = get().favorites.some((f) => (f._id || f) === userId);
    set((s) => ({
      favorites: isFav ? s.favorites.filter((f) => (f._id || f) !== userId) : [...s.favorites, s.contacts.find((c) => c._id === userId) || { _id: userId }],
    }));
    if (!DEMO_MODE) await api.post(`/users/me/favorites/${userId}`);
    return !isFav;
  },

  /** Block / unblock a user (toggle). The server enforces blocks in both
   *  directions — a blocked user can't send you requests, chat, or call you. */
  toggleBlock: async (userId) => {
    if (DEMO_MODE) return true;
    const { data } = await api.post(`/users/me/block/${userId}`);
    await get().load(); // refresh contacts (blocking also affects the relationship)
    return data.blocked;
  },

  /** File a moderation report (user / group / message / status). */
  report: async ({ targetType, targetUser, targetChat, targetMessage, reason, description = '' }) => {
    if (DEMO_MODE) return { success: true };
    const { data } = await api.post('/reports', { targetType, targetUser, targetChat, targetMessage, reason, description });
    return data;
  },

  /** Open (or create) a 1:1 chat with a contact. Returns the chat id or null. */
  startChat: async (user) => {
    const chatStore = useChat.getState();
    if (DEMO_MODE) {
      const existing = chatStore.chats.find((c) => !c.isGroup && c.peer?._id === user._id);
      if (existing) {
        chatStore.setActiveChat(existing._id);
        return existing._id;
      }
      const chat = { _id: `c-${user._id}`, isGroup: false, peer: user, unreadCount: 0, lastMessage: null };
      chatStore.addChat(chat);
      chatStore.setActiveChat(chat._id);
      return chat._id;
    }
    const { data } = await api.post(`/chats/direct/${user._id}`);
    chatStore.addChat(data.chat);
    chatStore.setActiveChat(data.chat._id);
    return data.chat._id;
  },
}));
