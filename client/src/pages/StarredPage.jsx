import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, MessageSquare, Loader2, ArrowRight, Lock, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import api, { DEMO_MODE } from '@/lib/api';
import { cn, formatDate, formatDateSeparator, PAGE_SHELL } from '@/lib/utils';
import { getChatDisplay } from '@/lib/chat';
import { useAuth } from '@/store/useAuth';
import { useChat } from '@/store/useChat';

/**
 * Starred messages.
 *
 * The endpoint has always returned the full list; the only thing consuming it
 * was a toast that reported the COUNT and threw the rows away. This is the
 * screen those rows were always meant for: grouped by day, each row jumping
 * straight to the message in its conversation.
 *
 * Encrypted rows arrive as ciphertext and are decrypted here, per chat, the
 * same way the message list does it.
 */

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.03 } } };
const rise = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } } };

export default function StarredPage() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const jumpToMessage = useChat((s) => s.jumpToMessage);
  const toggleStarMessage = useChat((s) => s.toggleStarMessage);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (before) => {
      if (DEMO_MODE) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get('/messages/starred', { params: { before, limit: 40 } });
        const rows = await decrypt(data.messages || []);
        setMessages((prev) => (before ? [...prev, ...rows] : rows));
        setHasMore(Boolean(data.hasMore));
      } catch {
        toast.error('Could not load your starred messages.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [decrypt]
  );

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    const last = messages[messages.length - 1];
    if (!last) return;
    setLoadingMore(true);
    load(last.createdAt);
  };

  const open = async (m) => {
    const chatId = m.chat?._id || m.chat;
    if (!chatId) return;
    navigate('/');
    await jumpToMessage(chatId, m._id);
  };

  const unstar = async (m) => {
    const chatId = m.chat?._id || m.chat;
    setMessages((prev) => prev.filter((row) => row._id !== m._id));
    await toggleStarMessage(chatId, m._id);
  };

  // Group by day — a starred list is read by "when did I save this".
  const days = [];
  for (const m of messages) {
    const label = formatDateSeparator(m.createdAt) || 'Earlier';
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(m);
    else days.push({ label, items: [m] });
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        icon={Star}
        title="Starred messages"
        subtitle={
          loading
            ? 'Loading…'
            : `${messages.length}${hasMore ? '+' : ''} saved message${messages.length === 1 ? '' : 's'}`
        }
      />

      {loading ? (
        <div className="card mt-6 divide-y divide-border overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-content/10" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-1/3 animate-pulse rounded-full bg-content/10" />
                <span className="block h-2.5 w-2/3 animate-pulse rounded-full bg-content/10" />
              </span>
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={Star}
            title="Nothing starred yet"
            description="Star a message from its ⋯ menu and it will be saved here, across every conversation."
            action={
              <Button onClick={() => navigate('/')}>
                <MessageSquare size={17} /> Open chats
              </Button>
            }
          />
        </div>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="mt-6 space-y-5">
          {days.map((day) => (
            <section key={day.label}>
              <div className="mb-2 flex items-center gap-3 px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">{day.label}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="card divide-y divide-border overflow-hidden shadow-soft">
                {day.items.map((m) => (
                  <StarredRow key={m._id} message={m} me={me} onOpen={() => open(m)} onUnstar={() => unstar(m)} />
                ))}
              </div>
            </section>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
                {loadingMore ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function StarredRow({ message, me, onOpen, onUnstar }) {
  const chat = message.chat || {};
  const where = chat.isGroup ? chat.name : getChatDisplay(chat, me)?.name;
  const attachment = message.attachments?.[0];

  return (
    <motion.div
      variants={rise}
      className="group flex cursor-pointer items-start gap-3 p-3.5 transition-colors hover:bg-content/[0.035]"
      onClick={onOpen}
    >
      <Avatar src={message.sender?.avatar} name={message.sender?.name} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate text-sm font-semibold text-content">{message.sender?.name || 'Unknown'}</p>
          {where && (
            <span className="truncate text-[11px] text-content-muted">
              in <span className="font-medium">{where}</span>
            </span>
          )}
        </div>

        <p className={cn('mt-1 line-clamp-3 break-words text-sm', message.undecryptable ? 'italic text-content-muted' : 'text-content')}>
          {message.content || (attachment ? attachment.name || 'Attachment' : 'Message')}
        </p>

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-content-muted">
          <span>{formatDate(message.createdAt, 'd MMM · h:mm a')}</span>
          {attachment && (
            <span className="inline-flex items-center gap-1">
              <Paperclip size={11} /> {message.attachments.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnstar();
          }}
          title="Remove star"
          aria-label="Remove star"
          className="ring-brand grid h-9 w-9 place-items-center rounded-xl text-amber-400 transition-colors hover:bg-content/5"
        >
          <Star size={16} className="fill-amber-400" />
        </button>
        <span className="grid h-9 w-9 place-items-center rounded-xl text-content-muted opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowRight size={16} />
        </span>
      </div>
    </motion.div>
  );
}
