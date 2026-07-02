import { useEffect, useState } from 'react';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageComposer from './MessageComposer';
import RightPanel from './RightPanel';
import { useChat } from '../../store/useChat';
import { useAuth } from '../../store/useAuth';
import { getChatDisplay, chatPeerIds } from '../../lib/chat';
import { emitSocket } from '../../hooks/useSocket';
import { DEMO_MODE } from '../../lib/api';

const DEMO_REPLIES = ['Absolutely! 🙌', 'Sounds perfect.', 'Haha love that 😄', 'On it right now.', "Let's do it 🚀", 'Great idea!', '👍👍'];

export default function ChatArea({ chat }) {
  const currentUser = useAuth((s) => s.user);
  const { messagesByChat, loadingMessages, sendMessage, appendMessage, reactToMessage, setTyping, typing } = useChat();
  const [replyTo, setReplyTo] = useState(null);

  const messages = messagesByChat[chat._id] || [];
  const d = getChatDisplay(chat, currentUser);
  const peerIds = chatPeerIds(chat, currentUser);
  const typingIds = typing[chat._id] || [];
  const typingUser = typingIds.length && !d.isGroup ? d.peer : typingIds.length ? { name: 'Someone', avatar: '' } : null;

  useEffect(() => {
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
        <ChatHeader chat={chat} currentUser={currentUser} />
        <MessageList
          messages={messages}
          loading={loadingMessages}
          isGroup={d.isGroup}
          currentUser={currentUser}
          peerIds={peerIds}
          typingUser={typingUser}
          onReact={(id, emoji) => reactToMessage(chat._id, id, emoji)}
          onReply={setReplyTo}
        />
        <MessageComposer chatId={chat._id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSend={handleSend} />
      </div>
      <RightPanel chat={chat} currentUser={currentUser} />
    </div>
  );
}
