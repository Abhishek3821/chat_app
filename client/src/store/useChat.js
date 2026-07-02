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
}));
