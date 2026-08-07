import { create } from 'zustand';
import toast from 'react-hot-toast';
import api, { DEMO_MODE } from '../lib/api';
import { CHATS, MESSAGES } from '../lib/demoData';
import { useAuth } from './useAuth';
import { useE2EE } from './useE2EE';

/** Decrypt any encrypted messages in a batch before they enter the store, so
 *  every consumer (bubbles, search, previews) sees ordinary `content`. */
const hydrate = (chatId, messages) => useE2EE.getState().hydrate(chatId, messages);

// Safety net for "typing…" that never stops (peer disconnected mid-keystroke,
// their typing-stop was lost). Each typing flag auto-expires unless renewed.
const typingTimers = {}; // `${chatId}:${userId}` -> timeout id
const TYPING_TTL_MS = 7000;

// Monotonic counter so two optimistic sends in the same millisecond can never
// collide on the same temp id (a collision made appendMessage drop the second).
let tmpSeq = 0;

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
    // Skeletons only on the FIRST load. Background refreshes (socket
    // chat-updated) must never blank the visible list — that reads as the
    // whole app "refreshing" on every message.
    if (get().chats.length === 0) set({ loadingChats: true });
    try {
      const { data } = await api.get('/chats');
      set({ chats: data.chats });
    } finally {
      set({ loadingChats: false });
    }
  },

  /**
   * Re-sync after a socket reconnect: refresh the chat list and re-fetch the
   * open conversation, so anything that happened while the socket was down
   * (messages, edits, deletes, receipts) is filled in instead of lost.
   */
  resync: async () => {
    if (DEMO_MODE) return;
    const { activeChatId } = get();
    try {
      await get().loadChats();
      if (activeChatId) {
        const { data } = await api.get(`/messages/${activeChatId}`);
        const messages = await hydrate(activeChatId, data.messages);
        set((s) => ({ messagesByChat: { ...s.messagesByChat, [activeChatId]: messages } }));
      }
    } catch {
      /* transient — the next reconnect retries */
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
      // Decrypt before the messages land in the store — everything downstream
      // (bubbles, previews, in-memory search) then works on plain text and
      // needs no knowledge of encryption at all.
      const messages = await hydrate(chatId, data.messages);
      set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: messages } }));
      // Pins ride along on the first page, so the banner is up as the
      // conversation paints. Their messages need decrypting too.
      if (data.pins) {
        const pinned = await hydrate(chatId, data.pins.map((p) => p.message));
        get().setPins(
          chatId,
          data.pins.map((p, i) => ({ ...p, message: pinned[i] })),
          data.canPin
        );
      }
      // If someone joined this encrypted group after the key was sealed, mint a
      // version they can read. Deliberately not awaited: housekeeping must not
      // hold up painting the conversation.
      const chat = get().chats.find((c) => c._id === chatId);
      if (chat?.e2ee?.enabled) useE2EE.getState().ensureMembersKeyed(chatId);
    } finally {
      set({ loadingMessages: false });
    }
  },

  /**
   * Replace the loaded window with the messages AROUND one message — how a
   * search result older than the current page is opened. `anchorId` is handed
   * to the list so it can scroll to and highlight the hit.
   */
  loadMessageContext: async (chatId, messageId) => {
    if (DEMO_MODE) return null;
    set({ loadingMessages: true });
    try {
      const { data } = await api.get(`/messages/${chatId}/context/${messageId}`);
      const messages = await hydrate(chatId, data.messages);
      set((s) => ({
        messagesByChat: { ...s.messagesByChat, [chatId]: messages },
        // A context window is a SLICE of history, so the list must not assume
        // the top of it is the start of the conversation.
        windowedChats: { ...s.windowedChats, [chatId]: !data.atStart || !data.atEnd },
      }));
      return messages;
    } catch {
      return null;
    } finally {
      set({ loadingMessages: false });
    }
  },

  /** Chats currently showing a context slice rather than the live tail. */
  windowedChats: {},

  /** The message the list should scroll to and flash — set by "jump to result"
   *  from either search. Cleared by the list once it has done so. */
  jumpTarget: null, // { chatId, messageId }
  clearJumpTarget: () => set({ jumpTarget: null }),

  /**
   * Open a chat at a specific message, loading the surrounding history if that
   * message isn't in the current window. This is what makes a search hit from
   * six months ago actually openable.
   */
  jumpToMessage: async (chatId, messageId) => {
    await get().setActiveChat(chatId);
    const loaded = (get().messagesByChat[chatId] || []).some((m) => m._id === messageId);
    if (!loaded) await get().loadMessageContext(chatId, messageId);
    set({ jumpTarget: { chatId, messageId } });
  },

  /** Back to the newest messages after jumping into history. */
  resetMessageWindow: async (chatId) => {
    if (DEMO_MODE || !get().windowedChats[chatId]) return;
    set({ loadingMessages: true });
    try {
      const { data } = await api.get(`/messages/${chatId}`);
      const messages = await hydrate(chatId, data.messages);
      set((s) => ({
        messagesByChat: { ...s.messagesByChat, [chatId]: messages },
        windowedChats: { ...s.windowedChats, [chatId]: false },
      }));
    } finally {
      set({ loadingMessages: false });
    }
  },

  /**
   * Search one conversation's ENTIRE history.
   *
   * The server does it for ordinary chats (indexed, paginated, covers messages
   * that were never loaded here). For an encrypted chat it can't — it holds
   * ciphertext — so it says so and we search the decrypted cache locally
   * instead. That's a real limitation, not a silent one: the caller gets
   * `scope: 'local'` and the UI says the search only covers loaded messages.
   */
  searchInChat: async (chatId, query) => {
    const q = (query || '').trim();
    if (!q) return { messages: [], scope: 'none', hasMore: false };

    const localHits = () =>
      (get().messagesByChat[chatId] || [])
        .filter((m) => !m.isDeleted && (m.content || '').toLowerCase().includes(q.toLowerCase()))
        .slice(-50)
        .reverse();

    if (DEMO_MODE) return { messages: localHits(), scope: 'local', hasMore: false };

    try {
      const { data } = await api.get(`/messages/${chatId}/search`, { params: { q } });
      if (data.encrypted) return { messages: localHits(), scope: 'local', hasMore: false };
      const messages = await hydrate(chatId, data.messages || []);
      return { messages, scope: 'server', hasMore: Boolean(data.hasMore) };
    } catch {
      return { messages: localHits(), scope: 'local', hasMore: false };
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

  /**
   * A message that arrived over the socket. Goes through decryption first —
   * `appendMessage` is synchronous and used by optimistic/demo paths, so the
   * async step lives here rather than being forced onto every caller.
   */
  ingestMessage: async (chatId, message) => {
    const hydrated = message?.encrypted ? await useE2EE.getState().hydrateOne(chatId, message) : message;
    get().appendMessage(chatId, hydrated);
  },

  /** Encryption was switched on/off — or rekeyed — for a chat, possibly by
   *  someone else. Drop the cached key AND re-run decryption over whatever is
   *  loaded: a member who just received their first key copy is staring at a
   *  list of "🔒 could not decrypt" placeholders that are now readable. */
  applyChatE2EE: async (chatId, e2ee) => {
    useE2EE.getState().invalidateChat(chatId);
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, e2ee: { ...(c.e2ee || {}), ...e2ee } } : c)) }));

    const loaded = get().messagesByChat[chatId];
    if (!loaded?.some((m) => m.encrypted)) return;
    const rehydrated = await hydrate(chatId, loaded);
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: rehydrated } }));
  },

  /** Re-run decryption for a chat after the identity was unlocked on this
   *  device (the messages were fetched while it was still locked). */
  rehydrateChat: async (chatId) => {
    const loaded = get().messagesByChat[chatId];
    if (!loaded?.some((m) => m.encrypted)) return;
    const rehydrated = await hydrate(chatId, loaded);
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: rehydrated } }));
  },

  /** A wallpaper change made on another of my devices. */
  applyChatTheme: (chatId, wallpaper, bubble) =>
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, wallpaper, bubble } : c)) })),

  /** Set (or clear) this chat's wallpaper. Personal to me — optimistic + persisted. */
  setChatTheme: async (chatId, wallpaper = '', bubble = '') => {
    const prev = get().chats.find((c) => c._id === chatId);
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, wallpaper, bubble } : c)) }));
    if (DEMO_MODE) return;
    try {
      await api.put(`/users/me/chats/${chatId}/theme`, { wallpaper, bubble });
    } catch {
      set((s) => ({
        chats: s.chats.map((c) =>
          c._id === chatId ? { ...c, wallpaper: prev?.wallpaper || '', bubble: prev?.bubble || '' } : c
        ),
      }));
      toast.error('Could not save the wallpaper.');
    }
  },

  sendMessage: async ({ chatId, content, type = 'text', replyTo, attachments, location, viewOnce, retriedAfterRekey = false }) => {
    const me = useAuth.getState().user;
    const clientId = `tmp-${Date.now()}-${tmpSeq++}`;
    const optimistic = {
      _id: clientId,
      // Stable identity that survives the swap to the saved message below.
      // MessageList keys off this, so the bubble is NOT unmounted/remounted when
      // `_id` changes from the temp id to the real one — a remount replayed the
      // entry animation and made every sent message visibly blink.
      clientId,
      sender: me,
      content,
      type,
      attachments,
      replyTo,
      location,
      viewOnce,
      createdAt: new Date().toISOString(),
      status: 'sent',
      optimistic: true,
    };
    get().appendMessage(chatId, optimistic);

    if (DEMO_MODE) return optimistic;

    try {
      // Encrypted chat → seal the text here and send ciphertext only. The
      // optimistic bubble above already shows the plaintext locally, and
      // `rememberPlain` below keeps it readable when the saved copy echoes
      // back, so the sender never watches their own message decrypt.
      let encPayload;
      let outgoingContent = content;
      const chat = get().chats.find((c) => c._id === chatId);
      if (chat?.e2ee?.enabled) {
        encPayload = await useE2EE.getState().encryptForChat(chatId, content || '');
        outgoingContent = '';
      }

      const { data } = await api.post('/messages', {
        chatId,
        content: outgoingContent,
        enc: encPayload,
        type,
        attachments,
        location,
        viewOnce,
        replyTo: replyTo?._id,
      });
      if (encPayload) useE2EE.getState().rememberPlain(data.message._id, content || '');
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
            // Carry `clientId` across so the React key stays stable through the swap.
            [chatId]: list.map((m) => (m._id === optimistic._id ? { ...data.message, clientId } : m)),
          },
        };
      });
      return data.message;
    } catch (err) {
      // The chat's key rotated while this message was being composed (someone
      // joined the group on another device). Drop the stale cached key, pick up
      // the new version and send once more before giving up — otherwise a
      // perfectly valid message fails for a reason the user can do nothing about.
      const status = err?.response?.status;
      const staleKey = status === 409 && /encryption key/i.test(err.response?.data?.message || '');
      if (staleKey && !retriedAfterRekey) {
        useE2EE.getState().invalidateChat(chatId);
        set((s) => ({
          messagesByChat: {
            ...s.messagesByChat,
            [chatId]: (s.messagesByChat[chatId] || []).filter((m) => m._id !== optimistic._id),
          },
        }));
        return get().sendMessage({ chatId, content, type, replyTo, attachments, location, viewOnce, retriedAfterRekey: true });
      }

      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === optimistic._id ? { ...m, status: 'failed' } : m)),
        },
      }));
      const message = err?.response?.data?.message;
      if (message) toast.error(message);
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
  // Mirrors the server's updateMany: only messages the reader did NOT send.
  // Also flips the sidebar's lastMessage tick to read when someone else read.
  markReadBy: (chatId, userId) =>
    set((s) => {
      const meId = String(useAuth.getState().user?._id || '');
      const readerIsMe = String(userId) === meId;
      return {
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] || []).map((m) => {
            if (String(m.sender?._id ?? m.sender) === String(userId)) return m;
            return (m.readBy || []).some((r) => String(r.user?._id ?? r.user) === String(userId))
              ? m
              : { ...m, readBy: [...(m.readBy || []), { user: userId, at: new Date().toISOString() }] };
          }),
        },
        chats: readerIsMe
          ? s.chats
          : s.chats.map((c) =>
              c._id === chatId && c.lastMessage && String(c.lastMessage.sender?._id ?? c.lastMessage.sender) === meId
                ? { ...c, lastMessage: { ...c.lastMessage, status: 'read' } }
                : c
            ),
      };
    }),

  reactToMessage: async (chatId, messageId, emoji) => {
    const meId = useAuth.getState().user?._id || 'me';
    const isMine = (r) => r.user === 'me' || String(r.user?._id ?? r.user) === String(meId);
    // Optimistic toggle (WhatsApp: one reaction per person; tapping the same emoji clears it).
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) => {
          if (m._id !== messageId) return m;
          const reactions = m.reactions || [];
          const mine = reactions.find(isMine);
          if (mine && mine.emoji === emoji) return { ...m, reactions: reactions.filter((r) => r !== mine) };
          if (mine) return { ...m, reactions: reactions.map((r) => (r === mine ? { ...r, emoji } : r)) };
          return { ...m, reactions: [...reactions, { emoji, user: meId }] };
        }),
      },
    }));
    if (!DEMO_MODE) {
      try {
        const { data } = await api.post(`/messages/${messageId}/react`, { emoji });
        set((s) => ({
          messagesByChat: {
            ...s.messagesByChat,
            [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === messageId ? { ...m, reactions: data.message.reactions } : m)),
          },
        }));
      } catch {
        /* keep the optimistic reaction */
      }
    }
  },

  /** Apply a reaction update that arrived over the socket (from another user). */
  applyReaction: (chatId, messageId, reactions) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === messageId ? { ...m, reactions } : m)),
      },
    })),

  setTyping: (chatId, userId, isTyping) => {
    // Renew (or clear) the auto-expiry so a lost typing-stop can't leave a
    // permanent "typing…" indicator.
    const key = `${chatId}:${userId}`;
    clearTimeout(typingTimers[key]);
    if (isTyping) {
      typingTimers[key] = setTimeout(() => get().setTyping(chatId, userId, false), TYPING_TTL_MS);
    } else {
      delete typingTimers[key];
    }
    set((s) => {
      const current = s.typing[chatId] || [];
      if (isTyping && current.includes(userId)) return {}; // renewals shouldn't re-render
      const next = isTyping ? [...current, userId] : current.filter((u) => u !== userId);
      if (!isTyping && next.length === current.length) return {};
      return { typing: { ...s.typing, [chatId]: next } };
    });
  },

  // Pin / archive / mute a chat — optimistic local toggle + persist to the
  // account (server stores it per-user, so it survives reload and follows login).
  _toggleChatFlag: async (chatId, flag, action) => {
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, [flag]: !c[flag] } : c)) }));
    if (DEMO_MODE) return;
    try {
      await api.post(`/users/me/chats/${chatId}/${action}`);
    } catch {
      // revert on failure
      set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, [flag]: !c[flag] } : c)) }));
    }
  },
  togglePin: (chatId) => get()._toggleChatFlag(chatId, 'pinned', 'pin'),
  toggleArchive: (chatId) => get()._toggleChatFlag(chatId, 'archived', 'archive'),
  toggleMute: (chatId) => get()._toggleChatFlag(chatId, 'muted', 'mute'),

  /* ── Scheduled messages ───────────────────────────────────────────────
     Pending rows live server-side in their own collection and only become real
     messages at dispatch, so they are kept OUT of `messagesByChat` — putting
     them there would make them show up in history, search and unread counts. */
  scheduledByChat: {}, // { [chatId]: ScheduledMessage[] }

  loadScheduled: async (chatId) => {
    if (!chatId || DEMO_MODE) return;
    try {
      const { data } = await api.get(`/messages/scheduled/${chatId}`);
      set((s) => ({ scheduledByChat: { ...s.scheduledByChat, [chatId]: data.scheduled || [] } }));
    } catch {
      /* a failed load just leaves the previous list — no need to shout */
    }
  },

  scheduleMessage: async ({ chatId, sendAt, content = '', type = 'text', attachments, replyTo }) => {
    try {
      const { data } = await api.post('/messages/schedule', {
        chatId,
        sendAt,
        content,
        type,
        attachments,
        replyTo: replyTo?._id || replyTo,
      });
      set((s) => ({
        scheduledByChat: {
          ...s.scheduledByChat,
          [chatId]: [...(s.scheduledByChat[chatId] || []), data.scheduled].sort(
            (a, b) => new Date(a.sendAt) - new Date(b.sendAt)
          ),
        },
      }));
      return data.scheduled;
    } catch (err) {
      // Re-throw the SERVER's message. Letting the raw axios error through gave
      // the user "Request failed with status code 409" instead of the actual
      // reason ("Pick a time at least a few seconds from now", "…not available
      // in an encrypted chat"), which is most of why this felt broken.
      throw new Error(err?.response?.data?.message || 'Could not schedule that message.');
    }
  },

  cancelScheduled: async (chatId, id) => {
    try {
      await api.delete(`/messages/scheduled/${id}`);
    } catch (err) {
      throw new Error(err?.response?.data?.message || 'Could not cancel that message.');
    }
    set((s) => ({
      scheduledByChat: {
        ...s.scheduledByChat,
        [chatId]: (s.scheduledByChat[chatId] || []).filter((r) => String(r._id) !== String(id)),
      },
    }));
  },

  /** Socket 'scheduled-message' — the row was sent/cancelled/failed, possibly by
   *  another of my devices or by the server's dispatcher. */
  applyScheduledUpdate: ({ id, chatId, status, error }) => {
    if (!chatId) return;
    set((s) => {
      const list = s.scheduledByChat[chatId] || [];
      // 'sent' and 'cancelled' leave the pending list; 'failed' stays, annotated,
      // so the author can see it didn't go out.
      const next =
        status === 'failed'
          ? list.map((r) => (String(r._id) === String(id) ? { ...r, status, error } : r))
          : list.filter((r) => String(r._id) !== String(id));
      return { scheduledByChat: { ...s.scheduledByChat, [chatId]: next } };
    });
  },

  /** A pin/archive/mute made on ANOTHER of my devices (socket 'chat-flag').
   *  Deliberately takes the absolute value rather than toggling: the device that
   *  issued the change also receives this echo, and re-toggling there would undo
   *  the very action the user just took. Setting the value is idempotent. */
  applyChatFlag: (chatId, action, value) => {
    const flag = { pin: 'pinned', archive: 'archived', mute: 'muted' }[action];
    if (!flag) return;
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, [flag]: !!value } : c)) }));
  },

  addChat: (chat) => set((s) => (s.chats.some((c) => c._id === chat._id) ? {} : { chats: [chat, ...s.chats] })),

  /** Apply a chat update that arrived over the socket (group rename/avatar/
   *  members/roles…). Merges into the existing entry; unknown chats are added. */
  applyChatUpdate: (chat) =>
    set((s) => {
      if (!chat?._id) return {};
      const exists = s.chats.some((c) => c._id === chat._id);
      return { chats: exists ? s.chats.map((c) => (c._id === chat._id ? { ...c, ...chat } : c)) : [chat, ...s.chats] };
    }),

  /** A live-location share ended — flip its "live" badge off for everyone. */
  applyLiveLocationStopped: (chatId, messageId) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId ? { ...m, liveLocation: { ...(m.liveLocation || {}), active: false } } : m
        ),
      },
    })),

  /**
   * A pin/unpin from the socket — another participant, another of my devices, or
   * the server's expiry sweeper. On a pin we may not hold the message (it can be
   * older than the loaded window), so the banner is filled in from a fetch.
   */
  applyPinned: async (chatId, messageId, pinned, pin) => {
    if (!pinned) return get().expirePin(chatId, messageId);

    const known = (get().messagesByChat[chatId] || []).find((m) => m._id === messageId);
    if (!known || !pin) return get().loadPins(chatId); // need the message body → refetch
    set((s) => ({
      pinsByChat: {
        ...s.pinsByChat,
        [chatId]: [
          { ...pin, message: known },
          ...(s.pinsByChat[chatId] || []).filter((p) => p.messageId !== messageId),
        ],
      },
    }));
  },

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

  /**
   * Delete a message. scope 'me' removes it from my view only; scope 'everyone'
   * replaces it with a "this message was deleted" tombstone for all participants
   * (WhatsApp-style). Optimistic local update + API.
   */
  deleteMessage: async (chatId, messageId, scope = 'me') => {
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).flatMap((m) => {
          if (m._id !== messageId) return [m];
          return scope === 'everyone' ? [{ ...m, isDeleted: true, content: '', attachments: [] }] : [];
        }),
      },
    }));
    if (!DEMO_MODE) {
      try {
        await api.delete(`/messages/${messageId}?scope=${scope}`);
      } catch {
        /* already applied locally */
      }
    }
  },

  /** Edit a message's text — optimistic local update + API. */
  editMessage: async (chatId, messageId, content) => {
    const original = (get().messagesByChat[chatId] || []).find((m) => m._id === messageId);
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId ? { ...m, content, isEdited: true } : m
        ),
      },
    }));
    if (!DEMO_MODE) {
      try {
        // Same rule as sending: in an encrypted chat the replacement travels as
        // ciphertext, and the server refuses a plaintext edit outright.
        const chat = get().chats.find((c) => c._id === chatId);
        if (chat?.e2ee?.enabled) {
          const enc = await useE2EE.getState().encryptForChat(chatId, content);
          await api.patch(`/messages/${messageId}`, { enc });
          useE2EE.getState().rememberPlain(messageId, content);
        } else {
          await api.patch(`/messages/${messageId}`, { content });
        }
      } catch (err) {
        // Server refused (e.g. past the 5-minute edit window) — undo the optimistic edit.
        if (original) {
          set((s) => ({
            messagesByChat: {
              ...s.messagesByChat,
              [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
                m._id === messageId ? { ...m, content: original.content, isEdited: Boolean(original.isEdited) } : m
              ),
            },
          }));
        }
        toast.error(err.response?.data?.message || 'Could not edit message.');
      }
    }
  },

  /** Forward a message to one or more chats (server rebroadcasts to participants). */
  forwardMessage: async (message, targetChatIds = []) => {
    const payload = {
      content: message.content || '',
      type: message.type || 'text',
      attachments: message.attachments || [],
      location: message.location,
      forwardedFrom: message.sender?._id || message.sender,
    };
    if (DEMO_MODE) {
      const me = useAuth.getState().user;
      targetChatIds.forEach((cid, i) =>
        get().appendMessage(cid, {
          ...payload,
          _id: `fwd-${Date.now()}-${i}`,
          sender: me,
          forwarded: true,
          createdAt: new Date().toISOString(),
          status: 'sent',
        })
      );
      return;
    }
    for (const chatId of targetChatIds) {
      try {
        await api.post('/messages', { chatId, ...payload });
      } catch {
        /* skip this target */
      }
    }
  },

  /** Apply an edit that arrived over the socket (decrypting it first if the
   *  chat is encrypted — an edited ciphertext is a new ciphertext). */
  applyEditedMessage: async (chatId, message) => {
    const next = message?.encrypted ? await useE2EE.getState().hydrateOne(chatId, message) : message;
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === next._id ? { ...m, ...next } : m)),
      },
    }));
  },

  /** Apply a delete that arrived over the socket (scope 'everyone' → tombstone). */
  applyDeletedMessage: (chatId, messageId, scope = 'everyone') =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).flatMap((m) => {
          if (m._id !== messageId) return [m];
          return scope === 'everyone' ? [{ ...m, isDeleted: true, content: '', attachments: [] }] : [];
        }),
      },
    })),

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

  /* ── Pinned messages ──────────────────────────────────────────────────
     Chat-wide and time-limited: the pinner picks 1 / 6 / 12 / 24 hours, and in a
     group only admins may pin (the server is the authority on that — `canPin`
     below is just so the UI doesn't offer an action that will be refused).

     Pins live in their own slice rather than as a flag on each message, because
     a pinned message is very often older than the loaded window — there is no
     message object in `messagesByChat` to hang the flag on. */
  pinsByChat: {}, // { [chatId]: Pin[] }  Pin = { messageId, expiresAt, durationHours, pinnedBy, pinnedAt, message }
  canPinByChat: {}, // { [chatId]: boolean }

  setPins: (chatId, pins, canPin) =>
    set((s) => ({
      pinsByChat: { ...s.pinsByChat, [chatId]: pins || [] },
      canPinByChat: canPin === undefined ? s.canPinByChat : { ...s.canPinByChat, [chatId]: canPin },
    })),

  loadPins: async (chatId) => {
    if (DEMO_MODE || !chatId) return;
    try {
      const { data } = await api.get(`/messages/${chatId}/pins`);
      get().setPins(chatId, data.pins, data.canPin);
    } catch {
      /* leave whatever is shown */
    }
  },

  /** Pin for `hours`. Re-pinning an already-pinned message extends its timer. */
  pinMessage: async (chatId, messageId, hours) => {
    if (DEMO_MODE) return toast('Pinning is available in the full app.');
    try {
      const { data } = await api.post(`/messages/${messageId}/pin`, { hours });
      const message = (get().messagesByChat[chatId] || []).find((m) => m._id === messageId);
      set((s) => {
        const existing = (s.pinsByChat[chatId] || []).filter(
          // Drop the previous entry for this message (a re-pin) and anything the
          // server's cap pushed out, so the banner matches the server exactly.
          (p) => p.messageId !== messageId && !(data.evicted || []).includes(p.messageId)
        );
        return { pinsByChat: { ...s.pinsByChat, [chatId]: [{ ...data.pin, message }, ...existing] } };
      });
      toast.success(`Pinned for ${hours} ${hours === 1 ? 'hour' : 'hours'} 📌`);
      return data.pin;
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not pin this message.');
      return null;
    }
  },

  unpinMessage: async (chatId, messageId) => {
    const previous = get().pinsByChat[chatId] || [];
    set((s) => ({
      pinsByChat: { ...s.pinsByChat, [chatId]: previous.filter((p) => p.messageId !== messageId) },
    }));
    if (DEMO_MODE) return;
    try {
      await api.delete(`/messages/${messageId}/pin`);
    } catch (err) {
      set((s) => ({ pinsByChat: { ...s.pinsByChat, [chatId]: previous } })); // put it back
      toast.error(err?.response?.data?.message || 'Could not unpin this message.');
    }
  },

  /** Drop a pin locally once its clock runs out, without waiting for the
   *  server's sweep — the banner should vanish on time. */
  expirePin: (chatId, messageId) =>
    set((s) => ({
      pinsByChat: {
        ...s.pinsByChat,
        [chatId]: (s.pinsByChat[chatId] || []).filter((p) => p.messageId !== messageId),
      },
    })),

  /** Create a poll message in a chat. */
  createPoll: async ({ chatId, question, options, multi = false }) => {
    if (DEMO_MODE) {
      const me = useAuth.getState().user;
      get().appendMessage(chatId, {
        _id: `poll-${Date.now()}`,
        sender: me,
        type: 'poll',
        poll: { question, options: options.map((text) => ({ text, votes: [] })), multi, closed: false },
        createdAt: new Date().toISOString(),
        status: 'sent',
      });
      return null;
    }
    const { data } = await api.post('/messages/poll', { chatId, question, options, multi });
    get().appendMessage(chatId, data.message); // socket echoes it to everyone else
    return data.message;
  },

  /** Vote on / clear a poll option — optimistic, then reconcile with server truth. */
  votePoll: async (chatId, messageId, optionIndex) => {
    const meId = useAuth.getState().user?._id;
    const idOf = (v) => String(v?._id ?? v);
    const applyLocal = (m) => {
      if (m._id !== messageId || !m.poll) return m;
      const { multi } = m.poll;
      const options = m.poll.options.map((opt, i) => {
        const had = (opt.votes || []).some((v) => idOf(v) === String(meId));
        const without = (opt.votes || []).filter((v) => idOf(v) !== String(meId));
        if (multi) return { ...opt, votes: i === optionIndex ? (had ? without : [...without, meId]) : opt.votes };
        // single-select: my vote lives on at most one option
        if (i === optionIndex) return { ...opt, votes: had ? without : [...without, meId] };
        return { ...opt, votes: without };
      });
      return { ...m, poll: { ...m.poll, options } };
    };
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: (s.messagesByChat[chatId] || []).map(applyLocal) } }));
    if (DEMO_MODE) return;
    try {
      const { data } = await api.post(`/messages/${messageId}/vote`, { optionIndex });
      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === messageId ? data.message : m)),
        },
      }));
    } catch {
      /* keep the optimistic vote */
    }
  },

  /** Set the disappearing-messages timer for a chat (seconds; 0 = off). */
  setDisappearing: async (chatId, seconds) => {
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, disappearingSeconds: seconds } : c)) }));
    if (DEMO_MODE) return;
    try {
      await api.patch(`/chats/${chatId}/disappearing`, { seconds });
    } catch {
      /* leave optimistic value */
    }
  },

  /** Apply a disappearing-timer change that arrived over the socket. */
  applyDisappearing: (chatId, seconds) =>
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, disappearingSeconds: seconds } : c)) })),

  /** Mark a view-once message consumed locally (hide its media) + tell the server. */
  consumeViewOnce: async (chatId, messageId) => {
    const meId = useAuth.getState().user?._id;
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId ? { ...m, viewedBy: [...(m.viewedBy || []), meId] } : m
        ),
      },
    }));
    if (DEMO_MODE) return;
    try {
      await api.post(`/messages/${messageId}/viewed`);
    } catch {
      /* already hidden locally */
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

  // ── Chat lock ────────────────────────────────────────────────
  lockedChats: [], // populated by revealLockedChats after PIN entry
  lockChat: async (chatId) => {
    await api.post(`/chats/${chatId}/lock`);
    set((s) => ({
      chats: s.chats.filter((c) => c._id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
    }));
  },
  unlockChat: async (chatId) => {
    await api.post(`/chats/${chatId}/unlock`);
    set((s) => ({ lockedChats: s.lockedChats.filter((c) => c._id !== chatId) }));
    await get().loadChats();
  },
  revealLockedChats: async (pin) => {
    const { data } = await api.post('/chats/locked', { pin });
    set({ lockedChats: data.chats || [] });
    return data.chats || [];
  },

  // ── Live location ────────────────────────────────────────────
  startLiveLocation: async (chatId, coords, durationSecs = 3600) => {
    const { data } = await api.post('/live-location/start', { chatId, lat: coords.lat, lng: coords.lng, durationSecs });
    get().appendMessage(chatId, data.message);
    return data.message;
  },
  updateLiveLocation: async (messageId, coords) => {
    try {
      await api.post(`/live-location/${messageId}/update`, { lat: coords.lat, lng: coords.lng });
    } catch {
      /* the share may have expired — the watcher will be cleared by the caller */
    }
  },
  stopLiveLocation: async (messageId) => {
    try {
      await api.post(`/live-location/${messageId}/stop`);
    } catch {
      /* noop */
    }
  },
  /** Apply a live-location coordinate update that arrived over the socket. */
  applyLiveLocation: (chatId, messageId, lat, lng) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] || []).map((m) =>
          m._id === messageId ? { ...m, location: { ...(m.location || {}), lat, lng } } : m
        ),
      },
    })),

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
