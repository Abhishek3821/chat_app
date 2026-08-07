import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { MessageSkeleton } from '../ui/Skeleton';
import { cn, formatDateSeparator } from '../../lib/utils';
import { messageStatus } from '../../lib/chat';
import { useChat } from '../../store/useChat';
import { isSameDay } from 'date-fns';

function DateSeparator({ date }) {
  return (
    <div className="flex justify-center pb-4 pt-5">
      <span className="neu-raised-sm rounded-full bg-surface px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        {formatDateSeparator(date)}
      </span>
    </div>
  );
}

function MessageList({
  messages,
  loading,
  isGroup,
  currentUser,
  peerIds,
  typingUser,
  wallpaper,
  windowed,
  onReturnToLatest,
  // messageId → pin expiry, so a bubble knows it's pinned without the list
  // having to know how pins are stored.
  pinnedMap,
  canPin,
  onReact,
  onReply,
  onStar,
  onPin,
  onUnpin,
  onDelete,
  onForward,
  onEdit,
}) {
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const meId = currentUser?._id || 'me';

  // Where to scroll + flash after a "jump to this message" (from either the
  // header search or the global one). Cleared once acted on, so it fires once.
  const jumpTarget = useChat((s) => s.jumpTarget);
  const clearJumpTarget = useChat((s) => s.clearJumpTarget);
  const [highlighted, setHighlighted] = useState(null);
  const rowRefs = useRef(new Map());

  // Snapshot, once, which messages were ALREADY here when this chat opened.
  // Without this every bubble — including the entire history of a long chat —
  // replays its mount-in spring animation the instant you open the chat, a CPU
  // burst that competes with the socket/store work happening at the same time.
  // Only messages that arrive AFTER open (truly new) should animate in.
  // ChatArea keys MessageList by chat id, so this ref is naturally fresh per chat.
  // Stable identity for a message across the optimistic -> saved swap. A sent
  // message starts life with a `tmp-…` `_id` and `clientId`, then `_id` becomes
  // the real one while `clientId` stays put. Keying off `_id` therefore remounted
  // the bubble mid-send (replaying its entry animation) AND re-fired the
  // scroll-to-bottom effect. Everything identity-related below uses this.
  const keyOf = (m) => m.clientId || m._id;

  const initialIdsRef = useRef(null);
  if (initialIdsRef.current === null) {
    initialIdsRef.current = new Set(messages.map(keyOf));
  }

  // Scroll to the bottom only when something is APPENDED (new last message) or
  // the typing indicator appears — not when an old message is edited/reacted-to,
  // which used to yank the viewport down. Suppressed while showing a history
  // slice, where the newest loaded message is NOT the newest message.
  const lastId = messages.length ? keyOf(messages[messages.length - 1]) : null;
  useEffect(() => {
    if (!windowed) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastId, typingUser, windowed]);

  /* Land on the jumped-to message and flash it, so it's obvious which of the
     messages on screen was the one you picked. */
  useEffect(() => {
    if (!jumpTarget?.messageId) return undefined;
    const node = rowRefs.current.get(jumpTarget.messageId);
    if (!node) return undefined;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlighted(jumpTarget.messageId);
    clearJumpTarget();
    const timer = setTimeout(() => setHighlighted(null), 2200);
    return () => clearTimeout(timer);
  }, [jumpTarget, messages, clearJumpTarget]);

  if (loading) return <MessageSkeleton />;

  return (
    /* The soft canvas lighting lives on this NON-scrolling wrapper: as a
       background on the scroller itself, those two large radial gradients would
       repaint on every scroll frame. */
    <div className="chat-canvas relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        // The wallpaper lives on the scroll container, so it stays put behind
        // the bubbles instead of scrolling with them.
        style={wallpaper || undefined}
        className={cn('scrollbar-thin h-full overflow-y-auto px-3 py-4 sm:px-6 2xl:px-10', wallpaper && 'bg-fixed')}
      >
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const senderId = m.sender?._id || m.sender;
          const isMine = String(senderId) === String(meId);
          const newDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
          // show avatar on the last message of a consecutive run from the same sender
          const showAvatar = !next || (next.sender?._id || next.sender) !== senderId || next.type === 'system';
          // Consecutive messages from one person read as a block: tight inside a
          // run, a clear step when the speaker changes. `space-y-*` on the
          // scroller can't express that — it wins on specificity over a per-row
          // margin — so each row owns its own top gap instead.
          const startsRun = !prev || (prev.sender?._id || prev.sender) !== senderId || prev.type === 'system';
          return (
            <div
              key={keyOf(m)}
              ref={(node) => {
                if (node) rowRefs.current.set(m._id, node);
                else rowRefs.current.delete(m._id);
              }}
              className={cn(
                'rounded-2xl transition-colors duration-500',
                startsRun ? 'mt-3 first:mt-0' : 'mt-0.5',
                highlighted === m._id && 'bg-brand-500/15 ring-1 ring-brand-500/40'
              )}
            >
              {newDay && <DateSeparator date={m.createdAt} />}
              <MessageBubble
                message={m}
                isMine={isMine}
                isGroup={isGroup}
                isNew={!initialIdsRef.current.has(keyOf(m))}
                showAvatar={showAvatar}
                status={isMine ? messageStatus(m, currentUser, peerIds) : undefined}
                pinnedUntil={pinnedMap?.get(m._id)}
                canPin={canPin}
                onReact={onReact}
                onReply={onReply}
                onStar={onStar}
                onPin={onPin}
                onUnpin={onUnpin}
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

      {/* Showing a slice of history (arrived here from a search result) — the
          way back to the live conversation has to be obvious, or you're stuck
          somewhere in the past with no exit. */}
      {windowed && (
        <button
          onClick={onReturnToLatest}
          // No `neu-press` here: it animates `transform`, which would drop the
          // -translate-x-1/2 that centres this button.
          className="glass-strong absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-content transition-colors hover:bg-content/5"
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}
    </div>
  );
}

// Memoized: with stable callbacks from ChatArea, the whole list tree skips
// re-rendering unless this chat's messages / typing / wallpaper actually change.
export default memo(MessageList);
