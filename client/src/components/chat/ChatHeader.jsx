import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Video, Search, MoreVertical, PanelRight, X, Info, Eraser, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Avatar from '../ui/Avatar';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { getChatDisplay } from '../../lib/chat';
import { formatLastSeen, cn } from '../../lib/utils';

export default function ChatHeader({ chat, currentUser, search, onSearch }) {
  const { startCall, toggleRightPanel, setChatListOpen } = useUI();
  const clearChat = useChat((s) => s.clearChat);
  const deleteChat = useChat((s) => s.deleteChat);
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
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-3 backdrop-blur-xl sm:px-4">
        <Search size={18} className="shrink-0 text-content-muted" />
        <input
          autoFocus
          value={search || ''}
          onChange={(e) => onSearch?.(e.target.value)}
          placeholder={`Search messages${d.name ? ` with ${d.name}` : ''}`}
          className="min-w-0 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-muted"
        />
        <button onClick={closeSearch} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-content-muted hover:bg-content/5">
          <X size={18} />
        </button>
      </header>
    );
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/60 px-3 backdrop-blur-xl sm:px-4">
      <button onClick={() => setChatListOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl text-content-muted hover:bg-content/5 md:hidden">
        <ArrowLeft size={20} />
      </button>

      <button onClick={toggleRightPanel} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar src={d.avatar} name={d.name} size="md" online={d.isGroup ? undefined : isOnline} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-content">{d.name}</p>
          <p className="truncate text-xs text-content-muted">{status}</p>
        </div>
      </button>

      <div className="relative flex items-center gap-1">
        <HeaderBtn icon={Phone} onClick={() => startCall({ type: 'audio', peer: d.peer, group: d.isGroup ? chat : null, direction: 'outgoing' })} />
        <HeaderBtn icon={Video} onClick={() => startCall({ type: 'video', peer: d.peer, group: d.isGroup ? chat : null, direction: 'outgoing' })} />
        <HeaderBtn icon={Search} onClick={openSearch} className="hidden sm:grid" />
        <HeaderBtn icon={PanelRight} onClick={toggleRightPanel} className="hidden lg:grid" />
        <HeaderBtn icon={MoreVertical} onClick={() => setMenuOpen((v) => !v)} />

        {menuOpen && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-soft-lg">
              <MenuRow icon={Info} label={d.isGroup ? 'Group info' : 'Contact info'} onClick={() => { toggleRightPanel(); setMenuOpen(false); }} />
              <MenuRow icon={Search} label="Search messages" onClick={openSearch} />
              <MenuRow icon={Eraser} label="Clear messages" onClick={handleClear} />
              <MenuRow icon={Trash2} label={d.isGroup ? 'Delete group chat' : 'Delete chat'} danger onClick={handleDelete} />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function HeaderBtn({ icon: Icon, onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={cn('ring-brand grid h-10 w-10 place-items-center rounded-xl text-content-muted transition-colors hover:bg-content/5 hover:text-content', className)}
    >
      <Icon size={19} />
    </button>
  );
}

function MenuRow({ icon: Icon, label, danger, onClick }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-content/5', danger ? 'text-red-500' : 'text-content')}>
      <Icon size={16} /> {label}
    </button>
  );
}
