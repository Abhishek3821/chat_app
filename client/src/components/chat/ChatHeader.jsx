import { ArrowLeft, Phone, Video, Search, MoreVertical, PanelRight } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { getChatDisplay } from '../../lib/chat';
import { formatLastSeen, cn } from '../../lib/utils';

export default function ChatHeader({ chat, currentUser }) {
  const { startCall, toggleRightPanel, setChatListOpen } = useUI();
  const d = getChatDisplay(chat, currentUser);
  const typing = useChat((s) => (s.typing[chat._id] || []).length > 0);
  const peerOnline = useChat((s) => (d.peer?._id ? Boolean(s.online[d.peer._id]) : false));
  const isOnline = d.isGroup ? false : peerOnline || d.isOnline;

  const status = typing ? (
    <span className="text-brand-500">typing…</span>
  ) : d.isGroup ? (
    d.subtitle
  ) : isOnline ? (
    <span className="text-emerald-500">online</span>
  ) : (
    formatLastSeen(d.lastSeen)
  );

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

      <div className="flex items-center gap-1">
        <HeaderBtn icon={Phone} onClick={() => startCall({ type: 'audio', peer: d.peer, group: d.isGroup ? chat : null, direction: 'outgoing' })} />
        <HeaderBtn icon={Video} onClick={() => startCall({ type: 'video', peer: d.peer, group: d.isGroup ? chat : null, direction: 'outgoing' })} />
        <HeaderBtn icon={Search} className="hidden sm:grid" />
        <HeaderBtn icon={PanelRight} onClick={toggleRightPanel} className="hidden lg:grid" />
        <HeaderBtn icon={MoreVertical} />
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
