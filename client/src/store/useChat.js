import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';
import { CHATS, MESSAGES } from '../lib/demoData';
import { useAuth } from './useAuth';

export const useChat = create((set, get) => ({
  chats: [],
  activeChatId: null,
  messagesByChat: {},
  typing: {}, // chatId -> array of userIds currently typing
  online: {}, // userId -> true, kept live via socket presence events
  loadingChats: false,
  loadingMessages: false,
  search: '',

  setSearch: (search) => set({ search }),

  setPresenceSnapshot: (ids = []) => set({ online: Object.fromEntries(ids.map((id) => [String(id), true])) }),
  setUserOnline: (id) => set((s) => ({ online: { ...s.online, [String(id)]: true } })),
  setUserOffline: (id) =>
    set((s) => {
      const online = { ...s.online };
      delete online[String(id)];
      return { online };
    }),

  loadChats: async () => {
    if (DEMO_MODE) return set({ chats: CHATS });
    set({ loadingChats: true });
    try {
      const { data } = await api.get('/chats');
      set({ chats: data.chats });
    } finally {
      set({ loadingChats: false });
    }
  },

  setActiveChat: async (chatId) => {
    set((s) => ({
      activeChatId: chatId,
      chats: s.chats.map((c) => (c._id === chatId ? { ...c, unreadCount: 0 } : c)),
    }));
    if (get().messagesByChat[chatId]) return;

    if (DEMO_MODE) {
      set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: MESSAGES[chatId] || [] } }));
      return;
    }
    set({ loadingMessages: true });
    try {
      const { data } = await api.get(`/messages/${chatId}`);
      set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: data.messages } }));
    } finally {
      set({ loadingMessages: false });
    }
  },

  appendMessage: (chatId, message) =>
    set((s) => {
      const existing = s.messagesByChat[chatId] || [];
      if (existing.some((m) => m._id === message._id)) return {};
      // Own messages echo back over the socket too — they must never bump unread.
      const isMine = message.sender?._id === useAuth.getState().user?._id;
      return {
        messagesByChat: { ...s.messagesByChat, [chatId]: [...existing, message] },
        chats: s.chats.map((c) =>
          c._id === chatId
            ? {
                ...c,
                lastMessage: { content: message.content, createdAt: message.createdAt, sender: message.sender?._id },
                unreadCount:
                  chatId === s.activeChatId ? 0 : (c.unreadCount || 0) + (isMine ? 0 : 1),
              }
            : c
        ),
      };
    }),

  sendMessage: async ({ chatId, content, type = 'text', replyTo, attachments }) => {
    const me = useAuth.getState().user;
    const optimistic = {
      _id: `tmp-${Date.now()}`,
      sender: me,
      content,
      type,
      attachments,
      replyTo,
      createdAt: new Date().toISOString(),
      status: 'sent',
      optimistic: true,
    };
    get().appendMessage(chatId, optimistic);

    if (DEMO_MODE) return optimistic;

    try {
      const { data } = await api.post('/messages', { chatId, content, type, attachments, replyTo: replyTo?._id });
      set((s) => {
        // The saved message may ALSO have arrived via the socket echo before this
        // response resolved — drop that copy first, then swap the optimistic one,
        // otherwise the sender ends up with the message duplicated.
        const list = (s.messagesByChat[chatId] || []).filter(
          (m) => m._id !== data.message._id || m._id === optimistic._id
        );
        return {
          messagesByChat: {
            ...s.messagesByChat,
            [chatId]: list.map((m) => (m._id === optimistic._id ? data.message : m)),
          },
        };
      });
      return data.message;
    } catch {
      // mark failed
      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === optimistic._id ? { ...m, status: 'failed' } : m)),
        },
      }));
    }
  },

  // Mark a specific message delivered to a user (adds them to deliveredTo).
  markDelivered: (chatId, messageId, userId) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId && !(m.deliveredTo || []).some((u) => String(u?._id ?? u) === String(userId))
            ? { ...m, deliveredTo: [...(m.deliveredTo || []), userId] }
            : m
        ),
      },
    })),

  // Mark every message in a chat as read by a user (adds them to readBy).
  markReadBy: (chatId, userId) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          (m.readBy || []).some((r) => String(r.user?._id ?? r.user) === String(userId))
            ? m
            : { ...m, readBy: [...(m.readBy || []), { user: userId, at: new Date().toISOString() }] }
        ),
      },
    })),

  reactToMessage: (chatId, messageId, emoji) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) => {
          if (m._id !== messageId) return m;
          const reactions = m.reactions || [];
          const mine = reactions.find((r) => r.user === 'me' || r.user?._id === 'me');
          if (mine && mine.emoji === emoji) return { ...m, reactions: reactions.filter((r) => r !== mine) };
          if (mine) return { ...m, reactions: reactions.map((r) => (r === mine ? { ...r, emoji } : r)) };
          return { ...m, reactions: [...reactions, { emoji, user: 'me' }] };
        }),
      },
    })),

  setTyping: (chatId, userId, isTyping) =>
    set((s) => {
      const current = s.typing[chatId] || [];
      const next = isTyping ? [...new Set([...current, userId])] : current.filter((u) => u !== userId);
      return { typing: { ...s.typing, [chatId]: next } };
    }),

  togglePin: (chatId) =>
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, pinned: !c.pinned } : c)) })),
  toggleArchive: (chatId) =>
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, archived: !c.archived } : c)) })),
  toggleMute: (chatId) =>
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, muted: !c.muted } : c)) })),

  addChat: (chat) => set((s) => (s.chats.some((c) => c._id === chat._id) ? {} : { chats: [chat, ...s.chats] })),

  /** Create a group chat with the given members (real API or demo). Returns the chat. */
  createGroup: async ({ name, description = '', members = [] }) => {
    if (DEMO_MODE) {
      const chat = {
        _id: `g-${Date.now()}`,
        isGroup: true,
        name,
        description,
        avatar: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(name)}`,
        participants: [],
        unreadCount: 0,
        lastMessage: { content: 'Group created', createdAt: new Date().toISOString() },
      };
      get().addChat(chat);
      get().setActiveChat(chat._id);
      return chat;
    }
    const { data } = await api.post('/groups', { name, description, members });
    get().addChat(data.chat);
    get().setActiveChat(data.chat._id);
    return data.chat;
  },

  /** Get-or-create the 1:1 chat with a user and make it active. Returns the chat. */
  openDirectChat: async (userId) => {
    if (!userId) return null;
    // Already have a direct chat with this user open in the list? Use it.
    const existing = get().chats.find(
      (c) => !c.isGroup && (c.participants || []).some((p) => String(p.user?._id || p.user) === String(userId))
    );
    if (DEMO_MODE) {
      if (existing) get().setActiveChat(existing._id);
      return existing || null;
    }
    if (existing) {
      get().setActiveChat(existing._id);
      return existing;
    }
    const { data } = await api.post(`/chats/direct/${userId}`);
    get().addChat(data.chat);
    get().setActiveChat(data.chat._id);
    return data.chat;
  },

  /** Delete a message for everyone — optimistic local removal + API. */
  deleteMessage: async (chatId, messageId) => {
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).filter((m) => m._id !== messageId),
      },
    }));
    if (!DEMO_MODE) {
      try {
        await api.delete(`/messages/${messageId}`);
      } catch {
        /* already gone locally */
      }
    }
  },

  /** Star / unstar a message — optimistic local toggle + API. */
  toggleStarMessage: async (chatId, messageId) => {
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId ? { ...m, starred: !m.starred } : m
        ),
      },
    }));
    if (!DEMO_MODE) {
      try {
        await api.post(`/messages/${messageId}/star`);
      } catch {
        /* noop */
      }
    }
  },

  /** Pin / unpin a message — optimistic local toggle + API. */
  togglePinMessage: async (chatId, messageId) => {
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId ? { ...m, pinned: !m.pinned } : m
        ),
      },
    }));
    if (!DEMO_MODE) {
      try {
        await api.post(`/messages/${messageId}/pin`);
      } catch {
        /* noop */
      }
    }
  },

  /** Empty a conversation (keeps the chat) — local + API. */
  clearChat: async (chatId) => {
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: [] } }));
    if (!DEMO_MODE) {
      try {
        await api.delete(`/chats/${chatId}/clear`);
      } catch {
        /* noop */
      }
    }
  },

  /** Delete a conversation entirely — removes it from the list + API. */
  deleteChat: async (chatId) => {
    set((s) => {
      const messagesByChat = { ...s.messagesByChat };
      delete messagesByChat[chatId];
      return {
        chats: s.chats.filter((c) => c._id !== chatId),
        activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
        messagesByChat,
      };
    });
    if (!DEMO_MODE) {
      try {
        await api.delete(`/chats/${chatId}`);
      } catch {
        /* noop */
      }
    }
  },
}));
