/** Resolve the display identity of a chat (works for demo + API shapes). */
export function getChatDisplay(chat, currentUser) {
  if (!chat) return { name: '', avatar: '', isOnline: false, isGroup: false };
  if (chat.isGroup) {
    return { name: chat.name, avatar: chat.avatar, isGroup: true, isOnline: false, subtitle: `${chat.members?.length ?? chat.participants?.length ?? 0} members` };
  }
  // Demo shape
  if (chat.peer) {
    return { name: chat.peer.name, avatar: chat.peer.avatar, isOnline: chat.peer.isOnline, lastSeen: chat.peer.lastSeen, peer: chat.peer, isGroup: false };
  }
  // API shape: pick the other participant
  const meId = currentUser?._id;
  const other = chat.participants?.map((p) => p.user).find((u) => String(u?._id) !== String(meId));
  return { name: other?.name || 'Unknown', avatar: other?.avatar, isOnline: other?.isOnline, lastSeen: other?.lastSeen, peer: other, isGroup: false };
}

/** Preview text for a chat's last message. */
export function lastMessagePreview(chat) {
  const m = chat?.lastMessage;
  if (!m) return 'Tap to start chatting';
  if (m.type === 'voice') return '🎤 Voice message';
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'video') return '🎬 Video';
  if (m.type === 'document') return '📎 Document';
  return m.content || '';
}
