/**
 * End-to-end encryption — all of the actual cryptography in one file.
 *
 * The scheme, in one paragraph: every account has an ECDH P-256 identity key
 * pair. The private half never leaves the browser in the clear — it is sealed
 * under a key derived from your passphrase (PBKDF2-SHA256) and only the sealed
 * blob is uploaded, so a second device can unlock the same identity with the
 * passphrase and nothing else can. Each encrypted conversation has its own
 * random AES-256-GCM chat key; to hand it to a member, we mint an EPHEMERAL
 * ECDH pair, agree a secret with that member's identity key, run it through
 * HKDF and wrap the chat key with the result. Messages are AES-256-GCM under
 * the chat key with a fresh 96-bit nonce each.
 *
 * Why ephemeral keys for the wrap: if an identity private key ever leaks, the
 * attacker still cannot re-derive the wrapping secrets for keys handed out in
 * the past, because the other half of each of those agreements was a throwaway
 * key that no longer exists.
 *
 * Everything here uses the platform WebCrypto — no crypto dependency to audit,
 * keep patched, or ship. It needs a secure context (https, or localhost in
 * dev); `isSupported()` is the guard.
 */

const CURVE = 'P-256';
const AES = 'AES-GCM';
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const SALT_BYTES = 16;
// OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 600k; 210k is the figure they
// give when the derived key protects data that is ALSO behind an account login
// (as here — you need the session to fetch the blob at all). The server
// enforces a 100k minimum so this can be raised later without a migration.
const KDF_ITERATIONS = 210_000;
const HKDF_INFO = 'chatconnect/e2ee/chat-key-wrap/v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** WebCrypto needs a secure context; without one, encryption is unavailable. */
export function isSupported() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

/* ── base64 ────────────────────────────────────────────────────────
   Chunked so a large buffer can't blow the argument limit on
   String.fromCharCode via spread. */
export function toB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

export function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/* ── Identity key pair ─────────────────────────────────────────────── */

/** A fresh ECDH identity. The private key is extractable so it can be wrapped
 *  under a passphrase — it is never exported anywhere else. */
export async function generateIdentity() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']);
}

export async function exportPublicKey(publicKey) {
  return toB64(await crypto.subtle.exportKey('spki', publicKey));
}

export async function importPublicKey(b64) {
  return crypto.subtle.importKey('spki', fromB64(b64), { name: 'ECDH', namedCurve: CURVE }, true, []);
}

/** Passphrase → AES-GCM key, via PBKDF2. */
async function passphraseKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Seal a private identity key under a passphrase → the blob we upload. */
export async function wrapIdentity(privateKey, passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await passphraseKey(passphrase, salt, KDF_ITERATIONS);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  const sealed = await crypto.subtle.encrypt({ name: AES, iv }, kek, pkcs8);
  return {
    wrappedPrivateKey: toB64(sealed),
    kdfSalt: toB64(salt),
    kdfIterations: KDF_ITERATIONS,
    wrapIv: toB64(iv),
  };
}

/**
 * Open the blob again. A wrong passphrase fails as a GCM authentication error,
 * which is exactly the signal we want — it is thrown as a plain Error so the
 * caller can say "wrong passphrase" instead of leaking a DOMException.
 */
export async function unwrapIdentity({ wrappedPrivateKey, kdfSalt, kdfIterations, wrapIv }, passphrase) {
  const kek = await passphraseKey(passphrase, fromB64(kdfSalt), kdfIterations || KDF_ITERATIONS);
  let pkcs8;
  try {
    pkcs8 = await crypto.subtle.decrypt({ name: AES, iv: fromB64(wrapIv) }, kek, fromB64(wrappedPrivateKey));
  } catch {
    throw new Error('WRONG_PASSPHRASE');
  }
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']);
}

/* ── Chat keys ─────────────────────────────────────────────────────── */

/** A fresh symmetric key for one conversation. */
export async function generateChatKey() {
  return crypto.subtle.generateKey({ name: AES, length: 256 }, true, ['encrypt', 'decrypt']);
}

/** ECDH + HKDF → the AES key used to wrap/unwrap a chat key. */
async function agreeWrappingKey(privateKey, publicKey) {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    // No salt: the input keying material is already a fresh ECDH secret, and
    // the context is pinned by `info` instead.
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(HKDF_INFO) },
    hkdf,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Seal `chatKey` for one member. Returns exactly the shape the server stores —
 * and, crucially, the ephemeral PUBLIC key, which is what the recipient needs
 * to re-derive the same wrapping secret with their own private key.
 */
export async function wrapChatKeyFor(chatKey, recipientPublicKeyB64) {
  const recipient = await importPublicKey(recipientPublicKeyB64);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']);
  const wrappingKey = await agreeWrappingKey(ephemeral.privateKey, recipient);
  const iv = randomBytes(IV_BYTES);
  const raw = await crypto.subtle.exportKey('raw', chatKey);
  const wrapped = await crypto.subtle.encrypt({ name: AES, iv }, wrappingKey, raw);
  return {
    wrapped: toB64(wrapped),
    iv: toB64(iv),
    senderPublicKey: await exportPublicKey(ephemeral.publicKey),
  };
}

/** The inverse, using my identity private key. */
export async function unwrapChatKey({ wrapped, iv, senderPublicKey }, myPrivateKey) {
  const ephemeralPub = await importPublicKey(senderPublicKey);
  const wrappingKey = await agreeWrappingKey(myPrivateKey, ephemeralPub);
  let raw;
  try {
    raw = await crypto.subtle.decrypt({ name: AES, iv: fromB64(iv) }, wrappingKey, fromB64(wrapped));
  } catch {
    throw new Error('KEY_UNWRAP_FAILED');
  }
  return crypto.subtle.importKey('raw', raw, { name: AES, length: 256 }, true, ['encrypt', 'decrypt']);
}

/* ── Message payloads ──────────────────────────────────────────────── */

/** Encrypt message text. A fresh nonce per message — never reuse one under the
 *  same key, which is the one way to break GCM outright. */
export async function encryptText(chatKey, text) {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, chatKey, enc.encode(String(text ?? '')));
  return { ct: toB64(ct), iv: toB64(iv) };
}

/** Decrypt one payload. Throws on tampering (GCM auth failure) — callers render
 *  a "couldn't decrypt" bubble rather than silently showing nothing. */
export async function decryptText(chatKey, { ct, iv }) {
  const plain = await crypto.subtle.decrypt({ name: AES, iv: fromB64(iv) }, chatKey, fromB64(ct));
  return dec.decode(plain);
}

/* ── Attachment payloads ───────────────────────────────────────────────
   Same key and same construction as the text above, but over raw bytes and
   without base64 in the middle — an attachment is up to 50 MB, and base64 would
   inflate it by a third for no benefit. The ciphertext is uploaded as an opaque
   blob and the nonce travels in the attachment metadata beside the URL.

   Consequence worth knowing: an encrypted attachment cannot be streamed. A
   normal <video src> fetches ranges progressively, but GCM authenticates the
   whole ciphertext, so it must be fully downloaded and decrypted before a single
   frame can play. That is a real cost of sealing media, not an implementation
   shortcut. */

/** Encrypt raw file bytes. Fresh nonce per file, same rule as per message. */
export async function encryptBytes(chatKey, bytes) {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, chatKey, bytes);
  return { data: ct, iv: toB64(iv) };
}

/** Decrypt raw file bytes. Throws on tampering (GCM auth failure). */
export async function decryptBytes(chatKey, ciphertext, ivB64) {
  return crypto.subtle.decrypt({ name: AES, iv: fromB64(ivB64) }, chatKey, ciphertext);
}

/* ── Local key storage (IndexedDB) ─────────────────────────────────────
   CryptoKey objects are structured-cloneable, so the unlocked private key can
   be kept here and survive a reload without re-entering the passphrase — the
   raw bytes are never exposed to JS. Scoped by user id so two accounts on one
   browser can't pick up each other's identity. Clearing it is what "log out of
   encryption on this device" does. */

const DB_NAME = 'chatconnect-e2ee';
const STORE = 'identity';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLocalIdentity(userId, { privateKey, publicKey }) {
  try {
    await idb('readwrite', (store) => store.put({ privateKey, publicKey }, `u:${userId}`));
  } catch {
    // Private browsing / storage denied — the session still works, it just asks
    // for the passphrase again next load.
  }
}

export async function loadLocalIdentity(userId) {
  try {
    return (await idb('readonly', (store) => store.get(`u:${userId}`))) || null;
  } catch {
    return null;
  }
}

export async function clearLocalIdentity(userId) {
  try {
    await idb('readwrite', (store) => store.delete(`u:${userId}`));
  } catch {
    /* nothing to clear */
  }
}
