import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { MessageSkeleton } from '../ui/Skeleton';
import { formatDateSeparator } from '../../lib/utils';
import { messageStatus } from '../../lib/chat';
import { isSameDay } from 'date-fns';

function DateSeparator({ date }) {
  return (
    <div className="my-4 flex justify-center">
      <span className="glass rounded-full px-3.5 py-1 text-[11px] font-semibold text-content-muted shadow-soft">
        {formatDateSeparator(date)}
      </span>
    </div>
  );
}

export default function MessageList({ messages, loading, isGroup, currentUser, peerIds, typingUser, onReact, onReply }) {
  const bottomRef = useRef(null);
  const meId = currentUser?._id || 'me';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUser]);

  if (loading) return <MessageSkeleton />;

  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4 sm:px-6">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const senderId = m.sender?._id || m.sender;
        const isMine = String(senderId) === String(meId);
        const newDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
        // show avatar on the last message of a consecutive run from the same sender
        const showAvatar = !next || (next.sender?._id || next.sender) !== senderId || next.type === 'system';
        return (
          <div key={m._id}>
            {newDay && <DateSeparator date={m.createdAt} />}
            <MessageBubble
              message={m}
              isMine={isMine}
              isGroup={isGroup}
              showAvatar={showAvatar}
              status={isMine ? messageStatus(m, currentUser, peerIds) : undefined}
              onReact={onReact}
              onReply={onReply}
            />
          </div>
        );
      })}
      <AnimatePresence>{typingUser && <TypingIndicator user={typingUser} />}</AnimatePresence>
      <div ref={bottomRef} />
    </div>
  );
}
