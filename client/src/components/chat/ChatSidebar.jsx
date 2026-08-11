import { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Search, Plus, Pin, BellOff, Check, CheckCheck, Users, Archive, Lock, LockOpen, Megaphone, MessageSquareOff } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { CountBadge, Chip } from '../ui/Badge';
import { ChatRowSkeleton } from '../ui/Skeleton';
import { useChat } from '../../store/useChat';
import { useUI } from '../../store/useUI';
import { useAuth } from '../../store/useAuth';
import { getChatDisplay, lastMessagePreview } from '../../lib/chat';
import { formatChatTime, cn } from '../../lib/utils';
import PinResetForm from '../PinResetForm';

const FILTERS = ['All', 'Unread', 'Groups', 'Archived', 'Locked'];

// Memoized with a stable onOpen callback: one incoming message re-renders only
// the affected row (its chat object changes), not every row in the list.
const ChatRow = memo(function ChatRow({ chat, active, onOpen, currentUser, animateReorder = true }) {
  const d = getChatDisplay(chat, currentUser);
  const peerOnline = useChat((s) => (d.peer?._id ? Boolean(s.online[d.peer._id]) : false));
  const isOnline = peerOnline || d.isOnline;
  // lastMessage.sender may be a populated object (server) or an id string
  // (demo / freshly-appended live message) — normalise before comparing.
  const lastSenderId = chat.lastMessage?.sender?._id ?? chat.lastMessage?.sender;
  const sentByMe = lastSenderId != null && String(lastSenderId) === String(currentUser?._id || 'me');
  return (
    <motion.button
      // `layout` makes framer-motion FLIP-measure EVERY row on any reorder (a
      // new message bumping a chat to the top) — real cost on a long list. Only
      // the near-top rows (where reordering is actually visible/likely) get it.
      layout={animateReorder}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onOpen(chat._id)}
      className={cn(
        'ring-brand group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors',
        // Only the open conversation is extruded — a list of 20 raised cards is
        // noise, and lifting exactly one of them is what makes it read as
        // selected without needing a border.
        active ? 'bg-brand-gradient shadow-glow-lg' : 'hover:bg-content/5'
      )}
    >
      <Avatar src={d.avatar} name={d.name} size="md" online={d.isGroup ? undefined : isOnline} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {d.isGroup && <Users size={13} className={cn('shrink-0', active ? 'text-white/80' : 'text-content-muted')} />}
          <p className={cn('truncate text-sm font-semibold', active ? 'text-white' : 'text-content')}>{d.name}</p>
          {/* Which conversations are sealed has to be legible from the list,
              not only once you're inside one. */}
          {chat.pinned && <Pin size={12} className={cn('shrink-0', active ? 'text-white/70' : 'text-content-muted')} />}
          <span className={cn('ml-auto shrink-0 text-[11px]', active ? 'text-white/80' : 'text-content-muted')}>
            {formatChatTime(chat.lastMessage?.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Same three states as the bubble ticks, and the same reason for a
              literal blue on "read" — see the Ticks note in MessageBubble. */}
          {sentByMe && (
            chat.lastMessage?.status === 'read' ? (
              <CheckCheck size={14} strokeWidth={2.75} className={active ? 'text-sky-200' : 'text-sky-500'} aria-label="Read" />
            ) : chat.lastMessage?.status === 'delivered' ? (
              <CheckCheck size={14} className={active ? 'text-white/70' : 'text-content-muted'} aria-label="Delivered" />
            ) : (
              <Check size={14} className={active ? 'text-white/70' : 'text-content-muted'} aria-label="Sent" />
            )
          )}
          <p className={cn('truncate text-xs', active ? 'text-white/85' : 'text-content-muted')}>{lastMessagePreview(chat)}</p>
          <div className="ml-auto flex items-center gap-1.5">
            {chat.muted && <BellOff size={13} className={active ? 'text-white/70' : 'text-content-muted'} />}
            {!active && <CountBadge count={chat.unreadCount} />}
          </div>
        </div>
      </div>
    </motion.button>
  );
});

/** Compact empty-state for the sidebar list — matches the app's visual
 *  language (icon badge + muted caption) instead of a bare line of text. */
function SidebarEmpty({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-12 text-center sm:px-6">
      <span className="neu-inset grid h-12 w-12 place-items-center rounded-2xl text-content-muted">
        <Icon size={20} />
      </span>
      {/* the query is interpolated in here — a long unbroken search term must wrap */}
      <p className="break-words text-sm text-content-muted">{message}</p>
    </div>
  );
}

export default function ChatSidebar() {
  // Narrow subscriptions: the sidebar must not re-render on typing ticks,
  // presence blips or message-body changes in open conversations.
  const chats = useChat((s) => s.chats);
  const activeChatId = useChat((s) => s.activeChatId);
  const setActiveChat = useChat((s) => s.setActiveChat);
  const loadingChats = useChat((s) => s.loadingChats);
  const setChatListOpen = useUI((s) => s.setChatListOpen);
  const openModal = useUI((s) => s.openModal);
  const currentUser = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = chats;
    if (filter === 'Archived') list = list.filter((c) => c.archived);
    else list = list.filter((c) => !c.archived);
    if (filter === 'Unread') list = list.filter((c) => c.unreadCount > 0);
    if (filter === 'Groups') list = list.filter((c) => c.isGroup);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((c) => getChatDisplay(c, currentUser).name?.toLowerCase().includes(q));
    }
    return list;
  }, [chats, filter, query, currentUser]);

  const pinned = filtered.filter((c) => c.pinned);
  const recent = filtered.filter((c) => !c.pinned);

  const openChat = useCallback((id) => {
    setActiveChat(id);
    setChatListOpen(false);
  }, [setActiveChat, setChatListOpen]);

  return (
    <aside className="frost flex h-full w-full min-w-0 flex-col border-r border-border/70 md:w-[340px] lg:w-[380px] 2xl:w-[420px]">
      <div className="flex items-center justify-between gap-2 px-3 pt-4 sm:px-4">
        <h2 className="min-w-0 truncate text-lg font-bold text-content">Chats</h2>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => navigate('/broadcasts')}
            title="Broadcast lists"
            className="neu-raised-sm neu-press ring-brand grid h-11 w-11 place-items-center rounded-full bg-surface text-content-muted hover:text-content sm:h-9 sm:w-9"
          >
            <Megaphone size={17} />
          </button>
          <button
            onClick={() => openModal('newChat')}
            className="btn-gradient ring-brand grid h-11 w-11 place-items-center rounded-full sm:h-9 sm:w-9"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="px-3 pt-3 sm:px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 z-[1] -translate-y-1/2 text-content-muted" size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="neu-inset ring-brand h-11 w-full rounded-full bg-surface-2 pl-10 pr-3 text-sm placeholder:text-content-muted sm:h-10"
          />
        </div>
      </div>

      <div className="no-scrollbar mt-3 flex shrink-0 gap-2 overflow-x-auto px-3 sm:px-4">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)} className="shrink-0">
            {f === 'Archived' ? <span className="flex items-center gap-1"><Archive size={12} /> Archived</span>
              : f === 'Locked' ? <span className="flex items-center gap-1"><Lock size={12} /> Locked</span>
              : f}
          </Chip>
        ))}
      </div>

      {filter === 'Locked' ? (
        <LockedSection />
      ) : (
      // The chat route is the one page AppLayout does NOT bottom-pad (it manages
      // its own columns), so the list has to clear the 68px mobile nav itself.
      <div className="scrollbar-thin mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-[calc(1rem+68px+env(safe-area-inset-bottom))] md:pb-4">
        {loadingChats ? (
          Array.from({ length: 6 }).map((_, i) => <ChatRowSkeleton key={i} />)
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                <Pin size={11} className="mr-1 inline" /> Pinned
              </div>
            )}
            {pinned.map((c, i) => (
              <ChatRow key={c._id} chat={c} active={c._id === activeChatId} onOpen={openChat} currentUser={currentUser} animateReorder={i < 30} />
            ))}
            {pinned.length > 0 && recent.length > 0 && (
              <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-content-muted">Recent</div>
            )}
            {recent.map((c, i) => (
              <ChatRow key={c._id} chat={c} active={c._id === activeChatId} onOpen={openChat} currentUser={currentUser} animateReorder={i < 30} />
            ))}
            {filtered.length === 0 && (
              <SidebarEmpty
                icon={query ? Search : MessageSquareOff}
                message={query ? `No chats match "${query}"` : filter === 'All' ? 'No chats yet' : `No ${filter.toLowerCase()} chats`}
              />
            )}
          </>
        )}
      </div>
      )}
    </aside>
  );
}

/** Locked-chats folder: enter the two-step PIN to reveal, then unlock chats
 *  back into the main list. */
function LockedSection() {
  const currentUser = useAuth((s) => s.user);
  const twoStepEnabled = useAuth((s) => Boolean(s.user?.twoStepEnabled));
  const lockedChats = useChat((s) => s.lockedChats);
  const revealLockedChats = useChat((s) => s.revealLockedChats);
  const unlockChat = useChat((s) => s.unlockChat);
  const [pin, setPin] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length < 4) return;
    setBusy(true);
    try {
      await revealLockedChats(pin);
      setRevealed(true);
    } catch (err) {
      toast.error(err?.message || 'Incorrect PIN.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  // Chat lock rides on the two-step PIN — point people to Settings until it's set.
  if (!twoStepEnabled) {
    return (
      <div className="scrollbar-thin mt-6 min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-center sm:px-6">
        <span className="neu-inset mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl text-brand-600 dark:text-brand-300"><Lock size={24} /></span>
        <p className="text-sm font-semibold text-content">Locked chats</p>
        <p className="mt-1 text-xs text-content-muted">
          Set up a two-step PIN in Settings → Privacy first — then you can hide any chat behind it.
        </p>
      </div>
    );
  }

  if (forgot) {
    return (
      <div className="scrollbar-thin mt-6 min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
        <PinResetForm
          onDone={() => { setForgot(false); setPin(''); toast('Enter your new PIN to reveal locked chats.', { icon: '🔐' }); }}
          onCancel={() => setForgot(false)}
        />
      </div>
    );
  }

  if (!revealed) {
    return (
      <form onSubmit={submit} className="scrollbar-thin mt-6 min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-center sm:px-6">
        <span className="neu-inset mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl text-brand-600 dark:text-brand-300"><Lock size={24} /></span>
        <p className="text-sm font-semibold text-content">Locked chats</p>
        <p className="mt-1 text-xs text-content-muted">Enter your two-step PIN to view chats you&apos;ve locked.</p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          type="password"
          autoFocus
          placeholder="••••"
          className="neu-inset mt-4 w-full rounded-2xl bg-surface-2 px-3 py-3 text-center text-lg tracking-[0.4em] text-content outline-none"
        />
        <button type="submit" disabled={busy || pin.length < 4} className="btn-gradient ring-brand mt-3 w-full rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Checking…' : 'Reveal'}
        </button>
        <button type="button" onClick={() => setForgot(true)} className="ring-brand mt-3 rounded px-1 text-xs font-medium text-brand-500 hover:underline">
          Forgot PIN?
        </button>
      </form>
    );
  }

  return (
    <div className="scrollbar-thin mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-[calc(1rem+68px+env(safe-area-inset-bottom))] md:pb-4">
      {lockedChats.length === 0 ? (
        <SidebarEmpty icon={Lock} message="No locked chats yet" />
      ) : (
        lockedChats.map((c) => {
          const d = getChatDisplay(c, currentUser);
          return (
            <div key={c._id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-content/5">
              <Avatar src={d.avatar} name={d.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content">{d.name}</p>
                <p className="truncate text-xs text-content-muted">{lastMessagePreview(c)}</p>
              </div>
              <button
                onClick={async () => { await unlockChat(c._id); toast.success('Chat unlocked — back in your list.'); }}
                className="neu-raised-sm neu-press ring-brand inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 py-1.5 text-xs font-medium text-brand-600 dark:text-brand-300"
              >
                <LockOpen size={13} /> Unlock
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
