import { memo, useEffect, useMemo, useRef } from 'react';
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

function MessageList({ messages, loading, isGroup, currentUser, peerIds, typingUser, searchQuery, onReact, onReply, onStar, onPin, onDelete, onForward, onEdit }) {
  const bottomRef = useRef(null);
  const meId = currentUser?._id || 'me';

  const q = (searchQuery || '').trim().toLowerCase();
  const visible = useMemo(
    () => (q ? messages.filter((m) => (m.content || '').toLowerCase().includes(q)) : messages),
    [messages, q]
  );

  // Scroll to the bottom only when something is APPENDED (new last message) or
  // the typing indicator appears — not when an old message is edited/reacted-to,
  // which used to yank the viewport down.
  const lastId = messages.length ? messages[messages.length - 1]._id : null;
  useEffect(() => {
    if (!q) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastId, typingUser, q]);

  if (loading) return <MessageSkeleton />;

  if (q && visible.length === 0) {
    return <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-sm text-content-muted">No messages match “{searchQuery}”.</div>;
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4 sm:px-6">
      {visible.map((m, i) => {
        const prev = visible[i - 1];
        const next = visible[i + 1];
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
              onStar={onStar}
              onPin={onPin}
              onDelete={onDelete}
              onForward={onForward}
              onEdit={onEdit}
            />
          </div>
        );
      })}
      <AnimatePresence>{typingUser && <TypingIndicator user={typingUser} />}</AnimatePresence>
      <div ref={bottomRef} />
    </div>
  );
}

// Memoized: with stable callbacks from ChatArea, the whole list tree skips
// re-rendering unless this chat's messages / typing / search actually change.
export default memo(MessageList);
