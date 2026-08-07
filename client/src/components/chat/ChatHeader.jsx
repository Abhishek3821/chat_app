import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Video, Search, MoreVertical, PanelRight, X, Info, Eraser, Trash2, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import Avatar from '../ui/Avatar';
import { useUI } from '../../store/useUI';
import { useAuth } from '../../store/useAuth';
import { useChat } from '../../store/useChat';
import { getChatDisplay } from '../../lib/chat';
import { formatLastSeen, cn } from '../../lib/utils';

export default function ChatHeader({ chat, currentUser, search, onSearch }) {
  const { startCall, toggleRightPanel, setChatListOpen } = useUI();
  const clearChat = useChat((s) => s.clearChat);
  const deleteChat = useChat((s) => s.deleteChat);
  const lockChat = useChat((s) => s.lockChat);
  const twoStepEnabled = useAuth((s) => s.user?.twoStepEnabled);
  const navigate = useNavigate();
  const d = getChatDisplay(chat, currentUser);
  const typing = useChat((s) => (s.typing[chat._id] || []).length > 0);
  const peerOnline = useChat((s) => (d.peer?._id ? Boolean(s.online[d.peer._id]) : false));
  const isOnline = d.isGroup ? false : peerOnline || d.isOnline;

  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const openSearch = () => {
    setMenuOpen(false);
    setSearchOpen(true);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    onSearch?.('');
  };

  const handleClear = async () => {
    setMenuOpen(false);
    if (!window.confirm('Clear all messages in this chat? This only affects your view.')) return;
    await clearChat(chat._id);
    toast.success('Messages cleared');
  };
  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm('Delete this conversation? It will be removed from your chat list.')) return;
    await deleteChat(chat._id);
    toast.success('Chat deleted');
    setChatListOpen(true);
    navigate('/');
  };
  const handleLock = async () => {
    setMenuOpen(false);
    if (!twoStepEnabled) {
      toast.error('Set up a two-step PIN in Settings first to lock chats.');
      return;
    }
    try {
      await lockChat(chat._id);
      toast.success('Chat locked. Find it under “Locked chats”.');
      setChatListOpen(true);
      navigate('/');
    } catch (err) {
      toast.error(err?.message || 'Could not lock this chat.');
    }
  };

  const status = typing ? (
    <span className="text-brand-500">typing…</span>
  ) : d.isGroup ? (
    d.subtitle
  ) : isOnline ? (
    <span className="text-emerald-500">online</span>
  ) : (
    formatLastSeen(d.lastSeen)
  );

  // ── Search mode: replace the header with a live in-chat message filter ──
  if (searchOpen) {
    return (
      <header className="frost neu-rail-bottom relative z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/70 px-2 sm:px-4">
        <label className="neu-inset flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3.5 py-2">
          <Search size={17} className="shrink-0 text-content-muted" />
          <input
            autoFocus
            value={search || ''}
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder={`Search messages${d.name ? ` with ${d.name}` : ''}`}
            className="min-w-0 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-muted"
          />
        </label>
        <HeaderBtn icon={X} onClick={closeSearch} />
      </header>
    );
  }

  return (
    /* z-10 + the rail bevel: the header has to sit ABOVE the conversation so
       its lift shadow falls onto the first message instead of under it. */
    <header className="frost neu-rail-bottom relative z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/70 px-2 sm:gap-3 sm:px-4">
      <HeaderBtn icon={ArrowLeft} onClick={() => setChatListOpen(true)} className="md:hidden" />

      <button onClick={toggleRightPanel} className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-1 py-1 text-left transition-colors hover:bg-content/5 sm:gap-3">
        <Avatar src={d.avatar} name={d.name} size="md" online={d.isGroup ? undefined : isOnline} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-content sm:text-base">
            <span className="truncate">{d.name}</span>
            {chat?.e2ee?.enabled && (
              // The lock belongs next to the name, not buried in the info panel:
              // whether a conversation is encrypted has to be visible while you
              // are typing into it.
              <Lock size={13} className="shrink-0 text-brand-500" aria-label="End-to-end encrypted" />
            )}
          </p>
          <p className="truncate text-xs text-content-muted">
            {chat?.e2ee?.enabled ? 'End-to-end encrypted' : status}
          </p>
        </div>
      </button>

      <div className="relative flex shrink-0 items-center gap-0.5 sm:gap-1">
        <HeaderBtn icon={Phone} onClick={() => startCall({ type: 'audio', peer: d.isGroup ? { name: d.name, avatar: d.avatar } : d.peer, group: d.isGroup ? chat : null, direction: 'outgoing' })} />
        <HeaderBtn icon={Video} onClick={() => startCall({ type: 'video', peer: d.isGroup ? { name: d.name, avatar: d.avatar } : d.peer, group: d.isGroup ? chat : null, direction: 'outgoing' })} />
        <HeaderBtn icon={Search} onClick={openSearch} className="hidden sm:grid" />
        {/* Inline right panel only exists from xl up (see RightPanel) — below that
            the panel is a drawer, reachable via the header/menu instead. */}
        <HeaderBtn icon={PanelRight} onClick={toggleRightPanel} className="hidden xl:grid" />
        <HeaderBtn icon={MoreVertical} onClick={() => setMenuOpen((v) => !v)} />

        {menuOpen && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="glass-strong absolute right-0 top-12 z-20 w-[min(13rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl py-1">
              <MenuRow icon={Info} label={d.isGroup ? 'Group info' : 'Contact info'} onClick={() => { toggleRightPanel(); setMenuOpen(false); }} />
              <MenuRow icon={Search} label="Search messages" onClick={openSearch} />
              <MenuRow icon={Lock} label="Lock chat" onClick={handleLock} />
              <MenuRow icon={Eraser} label="Clear messages" onClick={handleClear} />
              <MenuRow icon={Trash2} label={d.isGroup ? 'Delete group chat' : 'Delete chat'} danger onClick={handleDelete} />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

/** Round, extruded control that presses in when held. */
function HeaderBtn({ icon: Icon, onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'neu-raised-sm neu-press ring-brand grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-content-muted hover:text-content sm:h-10 sm:w-10',
        className
      )}
    >
      <Icon size={19} />
    </button>
  );
}

function MenuRow({ icon: Icon, label, danger, onClick }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-2.5 px-3 py-3 text-left text-sm transition-colors hover:bg-content/5 sm:py-2.5', danger ? 'text-red-500' : 'text-content')}>
      <Icon size={16} className="shrink-0" /> {label}
    </button>
  );
}
