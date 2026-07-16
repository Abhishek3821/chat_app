import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Search, Plus, Pin, BellOff, Check, CheckCheck, Users, Archive, Lock, LockOpen, Megaphone } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { CountBadge, Chip } from '../ui/Badge';
import { ChatRowSkeleton } from '../ui/Skeleton';
import { useChat } from '../../store/useChat';
import { useUI } from '../../store/useUI';
import { useAuth } from '../../store/useAuth';
import { getChatDisplay, lastMessagePreview } from '../../lib/chat';
import { formatChatTime, cn } from '../../lib/utils';

const FILTERS = ['All', 'Unread', 'Groups', 'Archived', 'Locked'];

function ChatRow({ chat, active, onClick, currentUser }) {
  const d = getChatDisplay(chat, currentUser);
  const peerOnline = useChat((s) => (d.peer?._id ? Boolean(s.online[d.peer._id]) : false));
  const isOnline = peerOnline || d.isOnline;
  // lastMessage.sender may be a populated object (server) or an id string
  // (demo / freshly-appended live message) — normalise before comparing.
  const lastSenderId = chat.lastMessage?.sender?._id ?? chat.lastMessage?.sender;
  const sentByMe = lastSenderId != null && String(lastSenderId) === String(currentUser?._id || 'me');
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors',
        active ? 'bg-brand-gradient shadow-glow' : 'hover:bg-content/5'
      )}
    >
      <Avatar src={d.avatar} name={d.name} size="md" online={d.isGroup ? undefined : isOnline} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {d.isGroup && <Users size={13} className={cn('shrink-0', active ? 'text-white/80' : 'text-content-muted')} />}
          <p className={cn('truncate text-sm font-semibold', active ? 'text-white' : 'text-content')}>{d.name}</p>
          {chat.pinned && <Pin size={12} className={cn('shrink-0', active ? 'text-white/70' : 'text-content-muted')} />}
          <span className={cn('ml-auto shrink-0 text-[11px]', active ? 'text-white/80' : 'text-content-muted')}>
            {formatChatTime(chat.lastMessage?.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {sentByMe && (chat.lastMessage?.status === 'read' ? <CheckCheck size={14} className={active ? 'text-white/80' : 'text-cyan-500'} /> : <Check size={14} className={active ? 'text-white/70' : 'text-content-muted'} />)}
          <p className={cn('truncate text-xs', active ? 'text-white/85' : 'text-content-muted')}>{lastMessagePreview(chat)}</p>
          <div className="ml-auto flex items-center gap-1.5">
            {chat.muted && <BellOff size={13} className={active ? 'text-white/70' : 'text-content-muted'} />}
            {!active && <CountBadge count={chat.unreadCount} />}
          </div>
        </div>
      </div>
    </motion.button>
  );
}

export default function ChatSidebar() {
  const { chats, activeChatId, setActiveChat, loadingChats } = useChat();
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

  const openChat = (id) => {
    setActiveChat(id);
    setChatListOpen(false);
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface/50 backdrop-blur-xl md:w-[340px] lg:w-[380px]">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-lg font-bold text-content">Chats</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate('/broadcasts')}
            title="Broadcast lists"
            className="ring-brand grid h-9 w-9 place-items-center rounded-xl text-content-muted transition-colors hover:bg-content/5 hover:text-content"
          >
            <Megaphone size={17} />
          </button>
          <button
            onClick={() => openModal('newChat')}
            className="ring-brand grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-500 transition-colors hover:bg-brand-500/20"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="ring-brand h-10 w-full rounded-xl border border-border bg-surface-2 pl-10 pr-3 text-sm placeholder:text-content-muted"
          />
        </div>
      </div>

      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4">
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
      <div className="scrollbar-thin mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {loadingChats ? (
          Array.from({ length: 6 }).map((_, i) => <ChatRowSkeleton key={i} />)
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                <Pin size={11} className="mr-1 inline" /> Pinned
              </div>
            )}
            {pinned.map((c) => (
              <ChatRow key={c._id} chat={c} active={c._id === activeChatId} onClick={() => openChat(c._id)} currentUser={currentUser} />
            ))}
            {pinned.length > 0 && recent.length > 0 && (
              <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-content-muted">Recent</div>
            )}
            {recent.map((c) => (
              <ChatRow key={c._id} chat={c} active={c._id === activeChatId} onClick={() => openChat(c._id)} currentUser={currentUser} />
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-content-muted">No chats found.</p>
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
  const lockedChats = useChat((s) => s.lockedChats);
  const revealLockedChats = useChat((s) => s.revealLockedChats);
  const unlockChat = useChat((s) => s.unlockChat);
  const [pin, setPin] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

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

  if (!revealed) {
    return (
      <form onSubmit={submit} className="mt-6 px-6 text-center">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500"><Lock size={24} /></span>
        <p className="text-sm font-semibold text-content">Locked chats</p>
        <p className="mt-1 text-xs text-content-muted">Enter your two-step PIN to view chats you&apos;ve locked.</p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          type="password"
          autoFocus
          placeholder="••••"
          className="mt-4 w-full rounded-xl border border-border bg-surface-2 px-3 py-3 text-center text-lg tracking-[0.4em] text-content outline-none focus:border-brand-500"
        />
        <button type="submit" disabled={busy || pin.length < 4} className="mt-3 w-full rounded-xl bg-brand-gradient py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Checking…' : 'Reveal'}
        </button>
      </form>
    );
  }

  return (
    <div className="scrollbar-thin mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
      {lockedChats.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-content-muted">No locked chats.</p>
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
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-500 hover:bg-brand-500/20"
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
