import { create } from 'zustand';
import api, { mediaUrl } from '../lib/api';
import { useAuth } from './useAuth';
import {
  isSupported,
  generateIdentity,
  exportPublicKey,
  wrapIdentity,
  unwrapIdentity,
  generateChatKey,
  wrapChatKeyFor,
  unwrapChatKey,
  encryptText,
  decryptText,
  encryptBytes,
  decryptBytes,
  saveLocalIdentity,
  loadLocalIdentity,
  clearLocalIdentity,
} from '../lib/e2ee';

/**
 * The app's view of end-to-end encryption: identity lifecycle, per-chat keys,
 * and the encrypt/decrypt boundary that `useChat` calls through.
 *
 * Status machine:
 *   unsupported → no WebCrypto (insecure context). Everything degrades to off.
 *   none        → no identity published yet; the user can set one up.
 *   locked      → an identity exists on the account, but this device doesn't
 *                 hold the private key (new browser, or "lock this device").
 *   unlocked    → private key in memory; encrypted chats are readable.
 *
 * Keys are cached in memory as `chatKeys[chatId][version]`. They are fetched
 * once per chat and reused; nothing re-derives per message.
 */

/* No lock emoji here: the bubble renders its own icon beside these (see
   MessageBubble's `unreadable` branch), and two locks in a row read as a glitch. */
const PLACEHOLDER_LOCKED = 'Encrypted — unlock encryption to read this message';
const PLACEHOLDER_FAILED = 'Could not decrypt this message';

export const useE2EE = create((set, get) => ({
  supported: isSupported(),
  status: 'idle', // idle | unsupported | none | locked | unlocked
  publicKey: '',
  privateKey: null, // CryptoKey, memory only
  identity: null, // the server's metadata blob (wrapped key, salt, iterations)
  chatKeys: {}, // { [chatId]: { [version]: CryptoKey } }
  chatState: {}, // { [chatId]: { enabled, version } }
  busy: false,

  /** Cache of decrypted text keyed by message id, so re-renders and re-loads of
   *  the same history don't re-run AES for every bubble on every pass. */
  _plain: new Map(),
  /** In-flight key fetches, so N messages landing at once cause ONE request. */
  _inflight: new Map(),
  /** Decrypted attachments as blob: URLs, keyed by the sealed file's URL, plus
   *  in-flight fetches so a re-render mid-download doesn't start a second one. */
  _media: new Map(),
  _mediaInflight: new Map(),

  /* ── Identity lifecycle ─────────────────────────────────────────── */

  init: async () => {
    if (!get().supported) return set({ status: 'unsupported' });
    const userId = useAuth.getState().user?._id;
    if (!userId) return set({ status: 'idle' });

    try {
      const { data } = await api.get('/e2ee/me');
      const identity = data.identity;
      if (!identity?.hasIdentity) {
        set({ status: 'none', identity: null, publicKey: '' });
        return;
      }

      // Already unlocked on this device? Use the stored key — but only if it
      // still matches the account's current public key. If they differ, the
      // identity was reset elsewhere and the local copy is stale garbage that
      // would fail every unwrap with a confusing error.
      const local = await loadLocalIdentity(userId);
      if (local?.privateKey && local.publicKey === identity.publicKey) {
        set({ status: 'unlocked', privateKey: local.privateKey, publicKey: identity.publicKey, identity });
        return;
      }
      if (local) await clearLocalIdentity(userId);
      set({ status: 'locked', identity, publicKey: identity.publicKey, privateKey: null });
    } catch {
      set({ status: 'idle' });
    }
  },

  /** First-time setup: mint an identity and publish it. */
  setup: async (passphrase, { replace = false } = {}) => {
    if (!get().supported) throw new Error('Encryption is not available in this browser.');
    if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    set({ busy: true });
    try {
      const pair = await generateIdentity();
      const publicKey = await exportPublicKey(pair.publicKey);
      const wrapped = await wrapIdentity(pair.privateKey, passphrase);
      await api.post('/e2ee/identity', { publicKey, ...wrapped, replace });

      const userId = useAuth.getState().user?._id;
      await saveLocalIdentity(userId, { privateKey: pair.privateKey, publicKey });
      set({
        status: 'unlocked',
        privateKey: pair.privateKey,
        publicKey,
        identity: { hasIdentity: true, publicKey, ...wrapped },
        chatKeys: {},
      });
      return true;
    } finally {
      set({ busy: false });
    }
  },

  /** Unlock the existing identity on this device. */
  unlock: async (passphrase) => {
    const identity = get().identity || (await api.get('/e2ee/me')).data.identity;
    if (!identity?.hasIdentity) throw new Error('No encryption identity to unlock.');
    set({ busy: true });
    try {
      const privateKey = await unwrapIdentity(identity, passphrase);
      const userId = useAuth.getState().user?._id;
      await saveLocalIdentity(userId, { privateKey, publicKey: identity.publicKey });
      set({ status: 'unlocked', privateKey, publicKey: identity.publicKey, identity });
      return true;
    } catch (err) {
      if (err.message === 'WRONG_PASSPHRASE') throw new Error('That passphrase is not right.');
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  /** Change the passphrase. Same key pair re-sealed, so nothing already
   *  encrypted for you stops working. */
  changePassphrase: async (current, next) => {
    if (!next || next.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    const identity = get().identity;
    if (!identity?.hasIdentity) throw new Error('Set up encryption first.');
    set({ busy: true });
    try {
      const privateKey = await unwrapIdentity(identity, current).catch(() => {
        throw new Error('Your current passphrase is not right.');
      });
      const wrapped = await wrapIdentity(privateKey, next);
      await api.patch('/e2ee/identity', wrapped);
      set({ identity: { ...identity, ...wrapped } });
      return true;
    } finally {
      set({ busy: false });
    }
  },

  /** Forget the private key on THIS device (the account keeps its identity). */
  lockDevice: async () => {
    const userId = useAuth.getState().user?._id;
    await clearLocalIdentity(userId);
    get()._plain.clear();
    get()._revokeMedia();
    set({ status: get().identity?.hasIdentity ? 'locked' : 'none', privateKey: null, chatKeys: {} });
  },

  /** Wipe local state on sign-out so the next account starts clean. */
  reset: () => {
    get()._plain.clear();
    get()._inflight.clear();
    get()._revokeMedia();
    set({ status: 'idle', privateKey: null, publicKey: '', identity: null, chatKeys: {}, chatState: {} });
  },

  /**
   * Release every decrypted attachment.
   *
   * Not just housekeeping: a blob: URL is a live handle to plaintext bytes. If
   * locking the device or signing out left them alive, "locked" would still be
   * serving decrypted media to anything holding the URL — and on a shared browser
   * that is the next person.
   */
  _revokeMedia: () => {
    for (const url of get()._media.values()) URL.revokeObjectURL(url);
    get()._media.clear();
    get()._mediaInflight.clear();
  },

  /* ── Per-chat keys ──────────────────────────────────────────────── */

  /** Fetch + unwrap every key version I hold for a chat. Deduped: concurrent
   *  callers share one request. */
  loadChatKeys: async (chatId) => {
    if (!chatId || get().status !== 'unlocked') return null;
    const cached = get().chatKeys[chatId];
    if (cached) return cached;

    const inflight = get()._inflight;
    if (inflight.has(chatId)) return inflight.get(chatId);

    const task = (async () => {
      try {
        const { data } = await api.get(`/e2ee/chats/${chatId}/keys`);
        const priv = get().privateKey;
        const byVersion = {};
        for (const k of data.keys || []) {
          try {
            byVersion[k.version] = await unwrapChatKey(k, priv);
          } catch {
            // One bad copy (e.g. sealed against a since-replaced identity)
            // shouldn't lose the versions that DO work.
          }
        }
        set((s) => ({
          chatKeys: { ...s.chatKeys, [chatId]: byVersion },
          chatState: { ...s.chatState, [chatId]: { enabled: data.enabled, version: data.version } },
        }));
        return byVersion;
      } catch {
        return null;
      } finally {
        get()._inflight.delete(chatId);
      }
    })();

    inflight.set(chatId, task);
    return task;
  },

  /** Turn encryption ON for a chat: mint a key and seal it for every member. */
  enableForChat: async (chatId) => {
    if (get().status !== 'unlocked') throw new Error('Unlock encryption first.');
    set({ busy: true });
    try {
      const { data } = await api.get(`/e2ee/chats/${chatId}/members`);
      if (data.missing?.length) {
        const names = data.missing.map((m) => m.name).join(', ');
        throw new Error(`${names} ${data.missing.length === 1 ? 'has' : 'have'} not set up encryption yet.`);
      }
      const chatKey = await generateChatKey();
      const keys = await Promise.all(
        data.members.map(async (m) => ({ user: m._id, ...(await wrapChatKeyFor(chatKey, m.publicKey)) }))
      );
      const { data: res } = await api.post(`/e2ee/chats/${chatId}/enable`, { keys });
      set((s) => ({
        chatKeys: { ...s.chatKeys, [chatId]: { [res.e2ee.version]: chatKey } },
        chatState: { ...s.chatState, [chatId]: res.e2ee },
      }));
      return res.e2ee;
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Mint the next key version for the CURRENT member list. Runs after someone
   * joins an encrypted group: they get the new version only, so the history
   * sealed under earlier versions stays closed to them.
   */
  rotateForChat: async (chatId) => {
    if (get().status !== 'unlocked') throw new Error('Unlock encryption first.');
    const { data } = await api.get(`/e2ee/chats/${chatId}/members`);
    if (data.missing?.length) {
      const names = data.missing.map((m) => m.name).join(', ');
      throw new Error(`${names} ${data.missing.length === 1 ? 'has' : 'have'} not set up encryption yet.`);
    }
    const chatKey = await generateChatKey();
    const keys = await Promise.all(
      data.members.map(async (m) => ({ user: m._id, ...(await wrapChatKeyFor(chatKey, m.publicKey)) }))
    );
    const { data: res } = await api.post(`/e2ee/chats/${chatId}/rotate`, { keys });
    set((s) => ({
      chatKeys: { ...s.chatKeys, [chatId]: { ...(s.chatKeys[chatId] || {}), [res.e2ee.version]: chatKey } },
      chatState: { ...s.chatState, [chatId]: res.e2ee },
    }));
    return res.e2ee;
  },

  disableForChat: async (chatId) => {
    const { data } = await api.post(`/e2ee/chats/${chatId}/disable`);
    set((s) => ({ chatState: { ...s.chatState, [chatId]: data.e2ee } }));
    return data.e2ee;
  },

  /**
   * Called when an encrypted chat is opened: if a member is missing a copy of
   * the current key (they joined after it was sealed), rotate so they can read
   * what happens next. Silent — it's housekeeping, not a user action.
   */
  ensureMembersKeyed: async (chatId) => {
    if (get().status !== 'unlocked') return;
    try {
      const { data } = await api.get(`/e2ee/chats/${chatId}/members`);
      if (data.e2ee?.enabled && data.needsRotation && !data.missing?.length) {
        await get().rotateForChat(chatId);
      }
    } catch {
      /* best effort — the next open tries again */
    }
  },

  /** Drop cached keys for a chat (its version moved on another device). */
  invalidateChat: (chatId) =>
    set((s) => {
      const chatKeys = { ...s.chatKeys };
      delete chatKeys[chatId];
      return { chatKeys };
    }),

  /* ── The encrypt / decrypt boundary ─────────────────────────────── */

  /** Seal outgoing text. Returns the `enc` envelope the API expects. */
  encryptForChat: async (chatId, text) => {
    const keys = (await get().loadChatKeys(chatId)) || {};
    const version = get().chatState[chatId]?.version;
    const key = keys[version];
    if (!key) throw new Error('No encryption key for this chat yet. Try reopening it.');
    const payload = await encryptText(key, text);
    return { ...payload, v: version };
  },

  /**
   * Decrypt a batch of messages into plain `content`, leaving `encrypted: true`
   * on them so the UI can still show the lock. Anything that can't be opened
   * gets a readable placeholder rather than an empty bubble.
   *
   * Non-encrypted messages pass through untouched, so this is safe to run over
   * a whole mixed history.
   */
  hydrate: async (chatId, messages) => {
    if (!Array.isArray(messages) || !messages.some((m) => m?.encrypted)) return messages;

    const plain = get()._plain;
    if (get().status !== 'unlocked') {
      return messages.map((m) => (m.encrypted ? { ...m, content: PLACEHOLDER_LOCKED, undecryptable: true } : m));
    }

    const keys = (await get().loadChatKeys(chatId)) || {};
    return Promise.all(
      messages.map(async (m) => {
        if (!m?.encrypted) return m;
        const cached = plain.get(m._id);
        if (cached !== undefined) return { ...m, content: cached };

        const key = keys[m.enc?.v];
        if (!key || !m.enc?.ct) return { ...m, content: PLACEHOLDER_FAILED, undecryptable: true };
        try {
          const text = await decryptText(key, m.enc);
          // Bounded so a very long session can't grow this without limit.
          if (plain.size > 5000) plain.clear();
          plain.set(m._id, text);
          return { ...m, content: text };
        } catch {
          return { ...m, content: PLACEHOLDER_FAILED, undecryptable: true };
        }
      })
    );
  },

  /** Single-message convenience for the socket path. */
  hydrateOne: async (chatId, message) => {
    const [out] = await get().hydrate(chatId, [message]);
    return out;
  },

  /** Remember locally-typed plaintext so the sender's own bubble reads normally
   *  the instant it echoes back, instead of briefly decrypting. */
  rememberPlain: (messageId, text) => {
    if (messageId) get()._plain.set(messageId, text);
  },

  /* ── Attachments ────────────────────────────────────────────────── */

  /**
   * Seal files for a chat before they are uploaded.
   *
   * Returns the ciphertext as `File`s to hand straight to `uploadFiles`, plus the
   * metadata the server never learns from the blob itself. The `.enc` extension
   * is deliberate: the upload allowlist is extension-based, and calling a sealed
   * blob `.jpg` would be a lie that the media route then serves as an image.
   *
   * The ORIGINAL name, mime and size are preserved in `meta` and stored on the
   * message, because the UI needs them to know it has an image rather than a
   * download — and after decryption it is that file again.
   */
  sealFiles: async (chatId, files) => {
    const keys = (await get().loadChatKeys(chatId)) || {};
    const version = get().chatState[chatId]?.version;
    const key = keys[version];
    if (!key) throw new Error('No encryption key for this chat yet. Try reopening it.');

    const list = [...files];
    const sealed = await Promise.all(
      list.map(async (file) => {
        const { data, iv } = await encryptBytes(key, await file.arrayBuffer());
        return {
          file: new File([data], `${file.name.replace(/\.[^.]+$/, '')}.enc`, { type: 'application/octet-stream' }),
          meta: { name: file.name, mime: file.type, size: file.size, enc: { iv, v: version } },
        };
      })
    );
    return { files: sealed.map((s) => s.file), meta: sealed.map((s) => s.meta) };
  },

  /**
   * Fetch a sealed attachment and decrypt it into a blob: URL for rendering.
   *
   * Cached by URL, because the same attachment is re-rendered on every list
   * update and re-downloading + re-decrypting 20 MB per render is not viable.
   * The cache holds the object URL, so it must never be revoked while a bubble
   * could still be pointing at it — hence process-lifetime, cleared on reset.
   */
  openAttachment: async (chatId, attachment) => {
    const url = attachment?.url;
    if (!url || !attachment.enc?.iv) return null;

    const cached = get()._media.get(url);
    if (cached) return cached;

    const inflight = get()._mediaInflight;
    if (inflight.has(url)) return inflight.get(url);

    const task = (async () => {
      try {
        const keys = (await get().loadChatKeys(chatId)) || {};
        const key = keys[attachment.enc.v] ?? keys[get().chatState[chatId]?.version];
        if (!key) return null;
        // mediaUrl() appends the short-lived media token — /uploads is not public.
        const res = await fetch(mediaUrl(url));
        if (!res.ok) return null;
        const plain = await decryptBytes(key, await res.arrayBuffer(), attachment.enc.iv);
        const objectUrl = URL.createObjectURL(new Blob([plain], { type: attachment.mime || 'application/octet-stream' }));
        get()._media.set(url, objectUrl);
        return objectUrl;
      } catch {
        return null;
      } finally {
        get()._mediaInflight.delete(url);
      }
    })();

    inflight.set(url, task);
    return task;
  },
}));
