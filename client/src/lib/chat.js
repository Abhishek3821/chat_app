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

/** The other participants' ids (everyone but me). Works for API + demo shapes. */
export function chatPeerIds(chat, currentUser) {
  const meId = String(currentUser?._id);
  if (!chat) return [];
  if (chat.peer) return [String(chat.peer._id)]; // demo 1:1
  return (chat.participants || [])
    .map((p) => String(p.user?._id ?? p.user))
    .filter((id) => id && id !== meId);
}

/**
 * Delivery status of one of MY messages, for the tick indicator:
 *   'sent'      → ✓   server has it, not yet on the recipient's device
 *   'delivered' → ✓✓  reached a recipient's device (grey)
 *   'read'      → ✓✓  all recipients have read it (coloured)
 * Derived from the message's deliveredTo / readBy arrays vs the other participants.
 */
export function messageStatus(m, currentUser, peerIds) {
  if (m.status === 'failed') return 'failed';
  if (m.optimistic) return 'sent';
  const others = peerIds || [];
  if (!others.length) return m.status || 'sent';
  const readers = new Set((m.readBy || []).map((r) => String(r.user?._id ?? r.user)));
  const delivered = new Set((m.deliveredTo || []).map((u) => String(u?._id ?? u)));
  if (others.every((id) => readers.has(id))) return 'read';
  if (others.some((id) => delivered.has(id) || readers.has(id))) return 'delivered';
  return 'sent';
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
