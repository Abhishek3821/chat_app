import { useCallback, useEffect, useMemo, useState } from 'react';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageComposer from './MessageComposer';
import RightPanel from './RightPanel';
import { useChat } from '../../store/useChat';
import { useAuth } from '../../store/useAuth';
import { useUI } from '../../store/useUI';
import { getChatDisplay, chatPeerIds } from '../../lib/chat';
import { emitSocket } from '../../hooks/useSocket';
import { DEMO_MODE } from '../../lib/api';

const DEMO_REPLIES = ['Absolutely! 🙌', 'Sounds perfect.', 'Haha love that 😄', 'On it right now.', "Let's do it 🚀", 'Great idea!', '👍👍'];
const EMPTY_MESSAGES = [];
const EMPTY_TYPING = [];
// Stable placeholder so a group "typing…" tick doesn't mint a new object every
// render (it feeds MessageList's scroll effect as a dependency).
const GROUP_TYPER = { name: 'Someone', avatar: '' };

export default function ChatArea({ chat }) {
  const currentUser = useAuth((s) => s.user);
  // Narrow, per-chat subscriptions: the WHOLE conversation view must not
  // re-render on unrelated store traffic (presence blips, other chats'
  // messages, sidebar updates). Zustand actions are stable references.
  const messages = useChat((s) => s.messagesByChat[chat._id]) || EMPTY_MESSAGES;
  const typingIds = useChat((s) => s.typing[chat._id]) || EMPTY_TYPING;
  const loadingMessages = useChat((s) => s.loadingMessages);
  const sendMessage = useChat((s) => s.sendMessage);
  const appendMessage = useChat((s) => s.appendMessage);
  const reactToMessage = useChat((s) => s.reactToMessage);
  const setTyping = useChat((s) => s.setTyping);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const editMessage = useChat((s) => s.editMessage);
  const toggleStarMessage = useChat((s) => s.toggleStarMessage);
  const togglePinMessage = useChat((s) => s.togglePinMessage);
  const openModal = useUI((s) => s.openModal);
  const [replyTo, setReplyTo] = useState(null);
  const [search, setSearch] = useState('');

  const chatId = chat._id;
  const d = getChatDisplay(chat, currentUser);
  const peerIds = useMemo(() => chatPeerIds(chat, currentUser), [chat, currentUser]);
  // Group members you can @mention (populated user objects, excluding yourself).
  const mentionables = useMemo(
    () =>
      d.isGroup
        ? (chat.participants || [])
            .map((p) => p.user)
            .filter((u) => u && typeof u === 'object' && u.username && String(u._id) !== String(currentUser?._id))
        : [],
    [d.isGroup, chat.participants, currentUser?._id]
  );
  const typingUser = typingIds.length ? (d.isGroup ? GROUP_TYPER : d.peer) : null;

  // Stable callbacks so the memoized MessageList/MessageBubble tree only
  // re-renders when the messages themselves change.
  const onReact = useCallback((id, emoji) => reactToMessage(chatId, id, emoji), [reactToMessage, chatId]);
  const onStar = useCallback((m) => toggleStarMessage(chatId, m._id), [toggleStarMessage, chatId]);
  const onPin = useCallback((m) => togglePinMessage(chatId, m._id), [togglePinMessage, chatId]);
  const onDelete = useCallback((m, scope) => deleteMessage(chatId, m._id, scope), [deleteMessage, chatId]);
  const onEdit = useCallback((m, content) => editMessage(chatId, m._id, content), [editMessage, chatId]);
  const onForward = useCallback((m) => openModal('forwardMessage', { message: m }), [openModal]);

  useEffect(() => {
    setSearch(''); // reset in-chat search when switching conversations
    emitSocket('join-chat', chat._id);
    emitSocket('message:read', { chatId: chat._id }); // opening the chat = read
    return () => emitSocket('leave-chat', chat._id);
  }, [chat._id]);

  // Re-mark read when new messages land while I'm looking at this chat.
  useEffect(() => {
    if (messages.length) emitSocket('message:read', { chatId: chat._id });
  }, [messages.length, chat._id]);

  const handleSend = async (payload) => {
    await sendMessage({ chatId: chat._id, ...payload });
    setReplyTo(null);

    // Demo mode: simulate a lively reply from the peer.
    if (DEMO_MODE && d.peer) {
      setTimeout(() => setTyping(chat._id, d.peer._id, true), 500);
      setTimeout(() => {
        setTyping(chat._id, d.peer._id, false);
        appendMessage(chat._id, {
          _id: `demo-${Date.now()}`,
          sender: d.peer,
          content: DEMO_REPLIES[Math.floor(payload.content?.length || 0) % DEMO_REPLIES.length],
          type: 'text',
          createdAt: new Date().toISOString(),
          status: 'read',
        });
      }, 2000);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader chat={chat} currentUser={currentUser} search={search} onSearch={setSearch} />
        <MessageList
          messages={messages}
          loading={loadingMessages}
          isGroup={d.isGroup}
          currentUser={currentUser}
          peerIds={peerIds}
          typingUser={typingUser}
          searchQuery={search}
          onReact={onReact}
          onReply={setReplyTo}
          onStar={onStar}
          onPin={onPin}
          onDelete={onDelete}
          onEdit={onEdit}
          onForward={onForward}
        />
        <MessageComposer chatId={chat._id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSend={handleSend} mentionables={mentionables} />
      </div>
      <RightPanel chat={chat} currentUser={currentUser} />
    </div>
  );
}
