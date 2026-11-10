// Share the last read watermark between the socket listener and mounted chat.
// No timer: distinct messages are acknowledged immediately, even in a burst.
const sockets = new WeakMap();
const MAX_CHATS = 128;

export function emitChatRead(socket, chatId, messageId, force = false) {
  if (!socket || !chatId) return false;
  const key = String(chatId);
  let chats = sockets.get(socket);
  if (!chats) { chats = new Map(); sockets.set(socket, chats); }
  const watermark = messageId ? String(messageId) : null;
  if (!force && watermark && chats.get(key) === watermark) return false;
  socket.emit('message:read', { chatId });
  // Remember only successful emits. Opening/reconnecting without a watermark
  // clears the previous one, so an old loaded page cannot suppress a new read.
  chats.delete(key);
  if (watermark) chats.set(key, watermark);
  if (chats.size > MAX_CHATS) chats.delete(chats.keys().next().value);
  return true;
}

export function resetChatReads(socket) {
  if (socket) sockets.delete(socket);
}
