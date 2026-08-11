import { create } from 'zustand';
import toast from 'react-hot-toast';
import api, { DEMO_MODE } from '../lib/api';
import { CHATS, MESSAGES } from '../lib/demoData';
import { useAuth } from './useAuth';
import { useE2EE } from './useE2EE';
import { useUI } from './useUI';

// Safety net for "typing…" that never stops (peer disconnected mid-keystroke,
// their typing-stop was lost). Each typing flag auto-expires unless renewed.
const typingTimers = {}; // `${chatId}:${userId}` -> timeout id
const TYPING_TTL_MS = 7000;

// Monotonic counter so two optimistic sends in the same millisecond can never
// collide on the same temp id (a collision made appendMessage drop the second).
let tmpSeq = 0;

/** Sending into a sealed chat with no key in memory. Distinct from an API failure
 *  because the fix is a passphrase, not a retry. */
class EncryptionLockedError extends Error {
  constructor() {
    super('Encryption is locked on this device.');
    this.name = 'EncryptionLockedError';
  }
}

/**
 * Is this conversation sealed?
 *
 * Two sources, in priority order: useE2EE's `chatState` is authoritative once the
 * chat has been opened (it comes from the keys endpoint), and the chat row's own
 * `e2ee.enabled` covers the window before that — `getChats` strips only the key
 * material, not the flag, precisely so this is answerable without a round-trip.
 */
function isEncrypted(chatId) {
  const known = useE2EE.getState().chatState[chatId];
  if (known) return Boolean(known.enabled);
  return Boolean(useChat.getState().chats.find((c) => c._id === chatId)?.e2ee?.enabled);
}

/**
 * Decrypt whatever needs it before the messages reach the store, so every
 * consumer downstream (bubbles, previews, in-chat search, starred, reply quotes)
 * reads `content` and neither knows nor cares that it arrived sealed.
 *
 * Never throws: `hydrate` substitutes a readable placeholder for anything it
 * can't open, because a chat that renders empty bubbles is worse than one that
 * says why it can't read them.
 */
/**
 * Encryption is always on, so opening a chat is also the moment to ensure it IS
 * sealed. Chats that existed before encryption became mandatory have no key, and
 * sealing them the first time someone opens them is the whole migration — no
 * script to run, no downtime, and the server never handles a key.
 *
 * Best-effort and quiet by design. It fails when a member hasn't signed in since
 * this shipped and so has no published public key to seal for; there is nothing
 * the opener can do about that, and a toast on every open would be pure noise.
 * Already-sent plaintext stays plaintext — re-sealing it would mean the server
 * reading it first, which is exactly what must not happen.
 */
async function autoSeal(chatId) {
  const e2ee = useE2EE.getState();
  if (e2ee.status !== 'unlocked') return;
  if (isEncrypted(chatId)) {
    e2ee.ensureMembersKeyed(chatId);
    return;
  }
  try {
    const state = await e2ee.enableForChat(chatId);
    useChat.setState((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, e2ee: state } : c)) }));
  } catch {
    /* a member has no identity yet — see above */
  }
}

async function decrypted(chatId, messages) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  try {
    return await useE2EE.getState().hydrate(chatId, messages);
  } catch {
    return messages;
  }
}

export const useChat = create((set, get) => ({
  chats: [],
  activeChatId: null,
  messagesByChat: {},
  loadingOlder: {}, // chatId -> true while a scroll-back page is in flight
  noMoreOlder: {}, // chatId -> true once we've reached the start of the conversation
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
        const messages = data.messages;
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
      const messages = await decrypted(chatId, data.messages);
      set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: messages } }));
      /* Seal it if it isn't yet, and re-key it if a member joined after the
         current version was minted — either way, opening a chat is the moment
         that gets its encryption into the right state. Not awaited: it must not
         hold up the paint of a conversation that is already readable. */
      autoSeal(chatId);
      // Pins ride along on the first page, so the banner is up as the
      // conversation paints.
      if (data.pins) {
        const pinned = data.pins.map((p) => p.message);
        get().setPins(
          chatId,
          data.pins.map((p, i) => ({ ...p, message: pinned[i] })),
          data.canPin
        );
      }
    } finally {
      set({ loadingMessages: false });
    }
  },

  /**
   * Fetch the page of messages OLDER than what's loaded, for scroll-back.
   *
   * The server has always paginated (`?before=<iso>&limit=40`) but nothing ever
   * sent the cursor — every fetch asked for the newest page. So a conversation
   * with more than 40 messages had no reachable history at all: scrolling up hit
   * a wall, and the only way to older messages was search-then-jump.
   *
   * Returns how many were prepended so the list can keep the viewport anchored
   * (prepending shifts everything down; without a correction the view jumps).
   */
  loadOlderMessages: async (chatId) => {
    if (DEMO_MODE) return 0;
    const s0 = get();
    if (s0.loadingOlder[chatId] || s0.noMoreOlder[chatId]) return 0;
    const loaded = s0.messagesByChat[chatId] || [];
    if (!loaded.length) return 0;

    // Cursor = the oldest message we hold. Optimistic sends have no server
    // timestamp yet, so skip anything without one.
    const oldest = loaded.find((m) => m.createdAt);
    if (!oldest) return 0;

    set((s) => ({ loadingOlder: { ...s.loadingOlder, [chatId]: true } }));
    try {
      const { data } = await api.get(`/messages/${chatId}`, {
        params: { before: new Date(oldest.createdAt).toISOString(), limit: 40 },
      });
      const older = await decrypted(chatId, data.messages || []);
      if (!older.length) {
        set((s) => ({ noMoreOlder: { ...s.noMoreOlder, [chatId]: true } }));
        return 0;
      }
      let added = 0;
      set((s) => {
        const current = s.messagesByChat[chatId] || [];
        const seen = new Set(current.map((m) => String(m._id)));
        const fresh = older.filter((m) => !seen.has(String(m._id)));
        added = fresh.length;
        return {
          messagesByChat: { ...s.messagesByChat, [chatId]: [...fresh, ...current] },
          // A short page means we've reached the beginning of the conversation.
          noMoreOlder: { ...s.noMoreOlder, [chatId]: older.length < 40 },
        };
      });
      return added;
    } catch {
      return 0;
    } finally {
      set((s) => ({ loadingOlder: { ...s.loadingOlder, [chatId]: false } }));
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
      const messages = await decrypted(chatId, data.messages);
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
      const messages = await decrypted(chatId, data.messages);
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
   * Server-side and indexed, so it covers messages that were never loaded on
   * this device. Falls back to a local scan of the loaded window if the request
   * fails, in which case the caller gets `scope: 'local'`.
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
      /* The server cannot match ciphertext, and says so rather than returning an
         empty list — otherwise a sealed chat full of hits reads as "no results".
         Fall back to the decrypted window this device already holds. */
      if (data.encrypted) return { messages: localHits(), scope: 'encrypted-local', hasMore: false };
      const messages = data.messages || [];
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
   * A message that arrived over the socket. Kept as the single entry point the
   * socket layer calls, so normalisation has one home; `appendMessage` stays the
   * synchronous path used by the optimistic and demo flows.
   */
  ingestMessage: async (chatId, message) => {
    get().appendMessage(chatId, await useE2EE.getState().hydrateOne(chatId, message));
  },

  /** Encryption was switched on/off for a chat (possibly on another device). */
  applyChatE2EE: async (chatId, e2ee) => {
    set((s) => ({ chats: s.chats.map((c) => (c._id === chatId ? { ...c, e2ee } : c)) }));
    // The cached key set is for the OLD version — drop it so the next read
    // re-fetches rather than failing every unwrap against a superseded key.
    useE2EE.getState().invalidateChat(chatId);
    if (get().messagesByChat[chatId]) await get().rehydrateChat(chatId);
  },

  /**
   * Re-run decryption over a chat's loaded window. Called after the identity is
   * unlocked (every bubble is showing the locked placeholder and needs a second
   * pass) and after a key rotation.
   */
  rehydrateChat: async (chatId) => {
    const loaded = get().messagesByChat[chatId];
    if (!loaded?.length) return;
    /* Reset the previous failure before retrying: the placeholder text has to go
       (it is not the message) and so does the flag, or a bubble that decrypts
       fine on the second pass still renders as unreadable. */
    const messages = await decrypted(
      chatId,
      loaded.map((m) => (m.undecryptable ? { ...m, content: '', undecryptable: false } : m))
    );
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: messages } }));
  },

  /** Unlocking applies to every conversation already on screen, not just the open one. */
  rehydrateAll: async () => {
    await Promise.all(Object.keys(get().messagesByChat).map((id) => get().rehydrateChat(id)));
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

  sendMessage: async ({ chatId, content, type = 'text', replyTo, attachments, location, viewOnce }) => {
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
      /**
       * Seal the text before it leaves the device.
       *
       * The optimistic bubble above keeps the plaintext — this is the device that
       * typed it, and it can obviously read it. What goes over the wire is the
       * `enc` envelope plus an EMPTY `content`, which is the whole point: the
       * server stores what it is given and cannot open this.
       *
       * `sealed` is retried once on a stale-version 409, because a rotation on
       * another device is a normal race, not an error worth showing anyone.
       */
      let sealed = null;
      if (isEncrypted(chatId)) {
        if (useE2EE.getState().status !== 'unlocked') {
          throw new EncryptionLockedError();
        }
        sealed = await useE2EE.getState().encryptForChat(chatId, content || '');
      }

      const post = () =>
        api.post('/messages', {
          chatId,
          content: sealed ? '' : content,
          enc: sealed || undefined,
          type,
          attachments,
          location,
          viewOnce,
          replyTo: replyTo?._id,
        });

      let data;
      try {
        ({ data } = await post());
      } catch (err) {
        const stale = sealed && err?.response?.status === 409 && /stale encryption key/i.test(err.response?.data?.message || '');
        if (!stale) throw err;
        useE2EE.getState().invalidateChat(chatId);
        sealed = await useE2EE.getState().encryptForChat(chatId, content || '');
        ({ data } = await post());
      }

      /* The echo of this message carries ciphertext, and re-decrypting it would
         be pointless work for a string already in hand — hand the plaintext to
         the cache so the sender's own bubble never flickers through a decrypt. */
      if (sealed) useE2EE.getState().rememberPlain(data.message._id, content || '');

      set((s) => {
        // The saved message may ALSO have arrived via the socket echo before this
        // response resolved — drop that copy first, then swap the optimistic one,
        // otherwise the sender ends up with the message duplicated.
        const list = (s.messagesByChat[chatId] || []).filter(
          (m) => m._id !== data.message._id || m._id === optimistic._id
        );
        /* The saved copy comes back with `content: ''` for a sealed message —
           that is what the database holds. Keep the plaintext we just typed, or
           swapping the optimistic bubble for the server's would blank it. */
        const saved = sealed ? { ...data.message, content: content || '' } : data.message;
        return {
          messagesByChat: {
            ...s.messagesByChat,
            // Carry `clientId` across so the React key stays stable through the swap.
            [chatId]: list.map((m) => (m._id === optimistic._id ? { ...saved, clientId } : m)),
          },
        };
      });
      return data.message;
    } catch (err) {
      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] || []).map((m) => (m._id === optimistic._id ? { ...m, status: 'failed' } : m)),
        },
      }));
      if (err instanceof EncryptionLockedError) {
        // Actionable rather than a dead end: the message is still there, marked
        // failed, and unlocking lets them retry it.
        toast.error('Unlock encryption to send in this chat.');
        useUI.getState().openModal('e2ee');
        return undefined;
      }
      const message = err?.response?.data?.message;
      if (message) toast.error(message);
      else if (err?.message) toast.error(err.message);
    }
    return undefined;
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
      // reason ("Pick a time at least a few seconds from now"), which is most
      // of why this felt broken.
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
    /* AWAITED, unlike the seal on open: a brand-new chat is one the user is about
       to type into immediately, and an unawaited seal would race that first send
       — which would then land as plaintext in a conversation that becomes sealed
       a moment later. Sealing before the chat is even active removes the race. */
    await autoSeal(data.chat._id);
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
    await autoSeal(data.chat._id); // awaited — see createGroup
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
        /* A sealed message is edited by REPLACING its ciphertext — there is no
           plaintext on the server to patch. Same envelope shape as a send, so the
           edit stays as unreadable to the server as the original was. */
        if (original?.encrypted) {
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

  /** Apply an edit that arrived over the socket. */
  applyEditedMessage: async (chatId, message) => {
    const next = message;
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
