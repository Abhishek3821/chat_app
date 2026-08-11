import User from '../models/User.js';
import Chat from '../models/Chat.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';
import { invalidateChatListCache } from '../utils/chatCache.js';

/**
 * End-to-end encryption key distribution.
 *
 * THE ONE INVARIANT: nothing in this file can read a message. Every value that
 * arrives here is already ciphertext produced in the browser —
 *   • `wrappedPrivateKey` is your identity key sealed under your passphrase;
 *   • `wrapped` (per chat, per member) is the chat key sealed under an ECDH
 *     secret between an ephemeral key and that member's identity key.
 * The server's whole job is storage and access control: who is allowed to
 * *fetch* which blob. It never derives, unwraps, or verifies plaintext, and it
 * must never grow an endpoint that does.
 *
 * The crypto itself lives in the client (`lib/e2ee.js`); this is deliberately
 * the boring half.
 */

// Base64 blobs are bounded so a client can't park megabytes in a user document.
// The real values are far smaller (P-256 SPKI ≈ 124 chars, a wrapped AES-256
// key ≈ 64); these are slack, not targets.
const LIMITS = { publicKey: 512, wrappedPrivateKey: 4096, salt: 256, iv: 256, wrappedKey: 512 };
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_KDF_ITERATIONS = 100_000; // floor; the client currently sends 210k

/** Validate a base64 field, or throw a 400 naming it. */
function b64(value, field, max) {
  if (typeof value !== 'string' || !value || value.length > max || !B64.test(value)) {
    throw new ApiError(400, `${field} must be a base64 string under ${max} characters.`);
  }
  return value;
}

/** Membership-gated chat fetch (same 403/404 shape as the message controller). */
async function memberChat(chatId, userId) {
  const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId });
  if (chat) return chat;
  const exists = await Chat.exists({ _id: chatId });
  throw new ApiError(exists ? 403 : 404, exists ? 'You are not a participant of this chat.' : 'Chat not found.');
}

/** Tell every participant the chat's encryption state moved. */
function broadcastState(chat) {
  const payload = {
    chatId: String(chat._id),
    e2ee: { enabled: chat.e2ee.enabled, version: chat.e2ee.version },
  };
  for (const p of chat.participants) emitToUser(String(p.user), 'chat-e2ee', payload);
  invalidateChatListCache(chat.participants.map((p) => p.user));
}

/* ── Identity ────────────────────────────────────────────────────── */

// GET /api/e2ee/me — my own key material, including the wrapped private half so
// a second device can unlock the SAME identity with the passphrase.
export const getMyIdentity = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id)
    .select('+e2ee.wrappedPrivateKey +e2ee.kdfSalt +e2ee.wrapIv')
    .lean();
  const e = me?.e2ee || {};
  res.json({
    success: true,
    identity: {
      hasIdentity: Boolean(e.publicKey),
      publicKey: e.publicKey || '',
      wrappedPrivateKey: e.wrappedPrivateKey || '',
      kdfSalt: e.kdfSalt || '',
      kdfIterations: e.kdfIterations || 0,
      wrapIv: e.wrapIv || '',
      generation: e.generation || 0,
      updatedAt: e.updatedAt || null,
    },
  });
});

// POST /api/e2ee/identity — publish a NEW identity (first setup, or a
// deliberate reset). Replacing an existing public key makes every chat key
// previously sealed for you unopenable, so it needs `replace: true` said out
// loud rather than being a silent side effect of a stray call.
export const publishIdentity = asyncHandler(async (req, res) => {
  const { publicKey, wrappedPrivateKey, kdfSalt, kdfIterations, wrapIv, replace } = req.body;
  b64(publicKey, 'publicKey', LIMITS.publicKey);
  b64(wrappedPrivateKey, 'wrappedPrivateKey', LIMITS.wrappedPrivateKey);
  b64(kdfSalt, 'kdfSalt', LIMITS.salt);
  b64(wrapIv, 'wrapIv', LIMITS.iv);
  const iterations = Number(kdfIterations);
  if (!Number.isInteger(iterations) || iterations < MIN_KDF_ITERATIONS) {
    throw new ApiError(400, `kdfIterations must be an integer of at least ${MIN_KDF_ITERATIONS}.`);
  }

  const me = await User.findById(req.user._id).select('e2ee');
  if (me.e2ee?.publicKey && me.e2ee.publicKey !== publicKey && !replace) {
    throw new ApiError(
      409,
      'You already have an encryption identity. Unlock it with your passphrase, or resend with replace:true to start over (this makes existing encrypted chats unreadable).'
    );
  }

  const rotated = Boolean(me.e2ee?.publicKey) && me.e2ee.publicKey !== publicKey;
  me.e2ee = {
    publicKey,
    wrappedPrivateKey,
    kdfSalt,
    kdfIterations: iterations,
    wrapIv,
    generation: (me.e2ee?.generation || 0) + (rotated ? 1 : 0),
    updatedAt: new Date(),
  };
  await me.save();
  res.json({ success: true, publicKey, generation: me.e2ee.generation });
});

// PATCH /api/e2ee/identity — passphrase change. Same key pair, re-wrapped under
// a key derived from the new passphrase, so nothing already sealed for you breaks.
export const rewrapIdentity = asyncHandler(async (req, res) => {
  const { wrappedPrivateKey, kdfSalt, kdfIterations, wrapIv } = req.body;
  b64(wrappedPrivateKey, 'wrappedPrivateKey', LIMITS.wrappedPrivateKey);
  b64(kdfSalt, 'kdfSalt', LIMITS.salt);
  b64(wrapIv, 'wrapIv', LIMITS.iv);
  const iterations = Number(kdfIterations);
  if (!Number.isInteger(iterations) || iterations < MIN_KDF_ITERATIONS) {
    throw new ApiError(400, `kdfIterations must be an integer of at least ${MIN_KDF_ITERATIONS}.`);
  }

  const me = await User.findById(req.user._id).select('e2ee');
  if (!me.e2ee?.publicKey) throw new ApiError(400, 'Set up encryption before changing its passphrase.');
  me.e2ee.wrappedPrivateKey = wrappedPrivateKey;
  me.e2ee.kdfSalt = kdfSalt;
  me.e2ee.kdfIterations = iterations;
  me.e2ee.wrapIv = wrapIv;
  me.e2ee.updatedAt = new Date();
  await me.save();
  res.json({ success: true });
});

/* ── Key distribution ────────────────────────────────────────────── */

// GET /api/e2ee/chats/:chatId/members — the public keys needed to seal a chat
// key for everyone in this conversation. Membership-gated: public keys are only
// public to people you can actually talk to.
export const getChatMemberKeys = asyncHandler(async (req, res) => {
  const chat = await memberChat(req.params.chatId, req.user._id);
  const ids = chat.participants.map((p) => p.user);
  const users = await User.find({ _id: { $in: ids } }).select('name username avatar e2ee.publicKey').lean();
  const members = users.map((u) => ({
    _id: String(u._id),
    name: u.name,
    username: u.username,
    avatar: u.avatar,
    publicKey: u.e2ee?.publicKey || '',
  }));
  // Who already holds a copy of the CURRENT key version. Anyone in the chat who
  // doesn't (because they joined after it was sealed) can't read new messages
  // until someone who does rotates the key for the new member list. Surfacing
  // it here is what lets a client notice and fix it on open, rather than the
  // newcomer staring at undecryptable messages forever.
  const keyed = new Set(
    (chat.e2ee.keys || [])
      .filter((k) => k.version === chat.e2ee.version)
      .map((k) => String(k.user))
  );
  const unkeyed = chat.e2ee.enabled ? members.filter((m) => !keyed.has(m._id)) : [];

  res.json({
    success: true,
    members,
    // Whoever hasn't set up encryption yet — the UI names them rather than
    // failing with a bare "some members are not ready".
    missing: members.filter((m) => !m.publicKey).map((m) => ({ _id: m._id, name: m.name })),
    needsRotation: unkeyed.length > 0,
    unkeyed: unkeyed.map((m) => ({ _id: m._id, name: m.name })),
    e2ee: { enabled: chat.e2ee.enabled, version: chat.e2ee.version },
  });
});

// GET /api/e2ee/chats/:chatId/keys — MY wrapped copies for this chat (every
// version I was given). The client unwraps them locally and caches them.
export const getMyChatKeys = asyncHandler(async (req, res) => {
  const chat = await memberChat(req.params.chatId, req.user._id);
  const mine = (chat.e2ee.keys || [])
    .filter((k) => String(k.user) === String(req.user._id))
    .map((k) => ({ version: k.version, wrapped: k.wrapped, iv: k.iv, senderPublicKey: k.senderPublicKey }))
    .sort((a, b) => a.version - b.version);
  res.json({
    success: true,
    enabled: chat.e2ee.enabled,
    version: chat.e2ee.version,
    keys: mine,
  });
});

/** Shared validation for an incoming set of per-member wrapped chat keys. */
function validateKeySet(rawKeys, chat) {
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) throw new ApiError(400, 'keys must be a non-empty list.');
  if (rawKeys.length > 512) throw new ApiError(400, 'Too many key copies in one request.');

  const memberIds = new Set(chat.participants.map((p) => String(p.user)));
  const seen = new Set();
  const keys = rawKeys.map((k) => {
    const user = String(k?.user || '');
    if (!memberIds.has(user)) throw new ApiError(400, 'A key was supplied for someone who is not in this chat.');
    if (seen.has(user)) throw new ApiError(400, 'Duplicate key copy for the same member.');
    seen.add(user);
    return {
      user,
      wrapped: b64(k.wrapped, 'wrapped', LIMITS.wrappedKey),
      iv: b64(k.iv, 'iv', LIMITS.iv),
      senderPublicKey: b64(k.senderPublicKey, 'senderPublicKey', LIMITS.publicKey),
    };
  });

  // Every current member must get a copy. A partial set would silently lock
  // someone out of their own conversation the moment the next message lands.
  const missing = [...memberIds].filter((id) => !seen.has(id));
  if (missing.length) throw new ApiError(400, 'Every member needs a key copy; some were missing.');
  return keys;
}

// POST /api/e2ee/chats/:chatId/enable  { keys:[{user,wrapped,iv,senderPublicKey}] }
// Turns encryption on. Messages sent from this point are sealed; everything
// already in the history stays as it was (it was never encrypted, and pretending
// otherwise by hiding it would just be theatre).
export const enableEncryption = asyncHandler(async (req, res) => {
  const chat = await memberChat(req.params.chatId, req.user._id);
  if (chat.e2ee.enabled) throw new ApiError(409, 'This chat is already encrypted.');

  const keys = validateKeySet(req.body.keys, chat);
  const version = (chat.e2ee.version || 0) + 1;
  chat.e2ee.enabled = true;
  chat.e2ee.version = version;
  chat.e2ee.enabledAt = new Date();
  chat.e2ee.enabledBy = req.user._id;
  chat.e2ee.keys.push(...keys.map((k) => ({ ...k, version, createdAt: new Date() })));
  await chat.save();

  broadcastState(chat);
  res.json({ success: true, e2ee: { enabled: true, version } });
});

// POST /api/e2ee/chats/:chatId/rotate  { keys:[…] }
// Mints the NEXT key version for the current member list. This is what runs
// after someone joins a group: they get a copy of the new version only, so the
// history sealed under earlier versions stays closed to them.
export const rotateKey = asyncHandler(async (req, res) => {
  const chat = await memberChat(req.params.chatId, req.user._id);
  if (!chat.e2ee.enabled) throw new ApiError(400, 'This chat is not encrypted.');

  const keys = validateKeySet(req.body.keys, chat);
  const version = (chat.e2ee.version || 0) + 1;
  chat.e2ee.version = version;
  chat.e2ee.keys.push(...keys.map((k) => ({ ...k, version, createdAt: new Date() })));

  // Drop key copies belonging to people who have since left, so a removed
  // member's blob doesn't linger for versions they were never meant to hold.
  const memberIds = new Set(chat.participants.map((p) => String(p.user)));
  chat.e2ee.keys = chat.e2ee.keys.filter((k) => memberIds.has(String(k.user)));
  await chat.save();

  broadcastState(chat);
  res.json({ success: true, e2ee: { enabled: true, version } });
});

// POST /api/e2ee/chats/:chatId/disable — new messages go back to being readable
// by the server. Past encrypted messages stay encrypted (their key copies are
// kept) — turning this off cannot retroactively open them, and shouldn't.
export const disableEncryption = asyncHandler(async (req, res) => {
  const chat = await memberChat(req.params.chatId, req.user._id);
  if (!chat.e2ee.enabled) return res.json({ success: true, e2ee: { enabled: false, version: chat.e2ee.version } });

  if (chat.isGroup) {
    const me = chat.participants.find((p) => String(p.user) === String(req.user._id));
    const isAdmin = me && (me.role === 'admin' || me.role === 'owner');
    if (!isAdmin && String(chat.e2ee.enabledBy) !== String(req.user._id)) {
      throw new ApiError(403, 'Only a group admin (or whoever turned it on) can turn encryption off.');
    }
  }

  chat.e2ee.enabled = false;
  await chat.save();
  broadcastState(chat);
  res.json({ success: true, e2ee: { enabled: false, version: chat.e2ee.version } });
});
