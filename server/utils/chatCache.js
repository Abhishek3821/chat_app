import { cacheGetJSON, cacheSetJSON, cacheDel } from './cache.js';

// Short TTL: this is a safety net for any write path that forgets to
// invalidate explicitly, not the primary correctness mechanism — every write
// that changes a chat's ordering/preview/unread count calls
// invalidateChatListCache() below, so in practice cached entries are almost
// always invalidated well before the TTL would matter.
const TTL_SECONDS = 10;

const listKey = (userId) => `chats:list:${userId}`;
const lockedKey = (userId) => `chats:locked:${userId}`;

export const getCachedChatList = (userId) => cacheGetJSON(listKey(userId));
export const setCachedChatList = (userId, chats) => cacheSetJSON(listKey(userId), chats, TTL_SECONDS);
export const getCachedLockedChatList = (userId) => cacheGetJSON(lockedKey(userId));
export const setCachedLockedChatList = (userId, chats) => cacheSetJSON(lockedKey(userId), chats, TTL_SECONDS);

/**
 * Invalidate one or more users' cached chat list (+ locked-chat list). Call
 * this from any write that changes a chat's ordering, last-message preview,
 * unread count, or a user's own pin/archive/mute/lock flags. Best-effort/no-op
 * when Redis isn't configured (same as the rest of utils/cache.js).
 */
export function invalidateChatListCache(userIds) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String);
  if (!ids.length) return undefined;
  return cacheDel(...ids.flatMap((id) => [listKey(id), lockedKey(id)]));
}
