import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Bell, Sun, Moon, Plus, Check } from 'lucide-react';
import { LogoMark } from '../brand/Logo';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { CountBadge } from '../ui/Badge';
import { useUI } from '../../store/useUI';
import { useAuth } from '../../store/useAuth';
import { useChat } from '../../store/useChat';
import { useNotifications } from '../../store/useNotifications';
import { formatRelative, cn } from '../../lib/utils';

const titles = {
  '/': 'Messages',
  '/calls': 'Calls',
  '/meetings': 'Meetings',
  '/status': 'Status',
  '/groups': 'Groups',
  '/contacts': 'Contacts',
  '/settings': 'Settings',
  '/admin': 'Admin Dashboard',
};

export default function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme, openModal } = useUI();
  const user = useAuth((s) => s.user);
  const notifs = useNotifications((s) => s.items);
  const loadNotifs = useNotifications((s) => s.load);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const markRead = useNotifications((s) => s.markRead);
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = notifs.filter((n) => !n.isRead).length;

  useEffect(() => {
    loadNotifs();
  }, [loadNotifs]);

  // Clicking a notification takes you to the thing it's about.
  const openNotification = (n) => {
    markRead(n._id);
    setNotifOpen(false);
    const chatId = n.data?.chatId;
    switch (n.type) {
      case 'message':
      case 'group_message':
      case 'mention':
        if (chatId) useChat.getState().setActiveChat(chatId);
        navigate('/');
        break;
      case 'incoming_call':
      case 'missed_call':
        navigate('/calls');
        break;
      case 'contact_request':
      case 'contact_accepted':
        navigate('/contacts');
        break;
      case 'meeting_reminder':
        navigate('/meetings');
        break;
      case 'status_reply':
        navigate('/status');
        break;
      default:
        navigate('/');
    }
  };

  return (
    <header className="z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/60 px-4 backdrop-blur-xl md:px-6">
      <div className="flex items-center gap-2 md:hidden">
        <LogoMark size={30} />
      </div>
      <h1 className="hidden text-xl font-bold text-content md:block">{titles[pathname] || 'ChatConnect'}</h1>

      <div className="relative mx-auto hidden w-full max-w-md lg:block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
        <input
          placeholder="Search people, messages, meetings…"
          className="ring-brand h-10 w-full rounded-xl border border-border bg-surface-2 pl-11 pr-4 text-sm placeholder:text-content-muted"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="primary" size="sm" className="hidden sm:inline-flex" onClick={() => openModal('newChat')}>
          <Plus size={16} /> New
        </Button>

        <button
          onClick={toggleTheme}
          className="ring-brand grid h-10 w-10 place-items-center rounded-xl text-content-muted transition-colors hover:bg-content/5 hover:text-content"
          aria-label="Toggle theme"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
              {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </motion.span>
          </AnimatePresence>
        </button>

        <div className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="ring-brand relative grid h-10 w-10 place-items-center rounded-xl text-content-muted transition-colors hover:bg-content/5 hover:text-content"
          >
            <Bell size={19} />
            <span className="absolute right-1.5 top-1.5">
              <CountBadge count={unread} className="h-4 min-w-[16px] text-[9px]" />
            </span>
          </button>

          <AnimatePresence>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  className="glass-strong absolute right-0 top-12 z-40 w-80 overflow-hidden rounded-2xl shadow-soft-lg"
                >
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="font-semibold text-content">Notifications</p>
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-brand-400"
                    >
                      <Check size={13} /> Mark all read
                    </button>
                  </div>
                  <div className="scrollbar-thin max-h-96 overflow-y-auto">
                    {notifs.length === 0 && (
                      <p className="px-4 py-8 text-center text-sm text-content-muted">You're all caught up 🎉</p>
                    )}
                    {notifs.map((n) => (
                      <button
                        key={n._id}
                        onClick={() => openNotification(n)}
                        className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-content/5', !n.isRead && 'bg-brand-500/5')}
                      >
                        {n.from ? (
                          <Avatar src={n.from.avatar} name={n.from.name} size="sm" />
                        ) : (
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/10 text-brand-500"><Bell size={16} /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-content">{n.title}</p>
                          <p className="truncate text-xs text-content-muted">{n.body}</p>
                          <p className="mt-0.5 text-[10px] text-content-muted">{formatRelative(n.createdAt)}</p>
                        </div>
                        {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gradient" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <button onClick={() => openModal('profile', user)} className="ml-1">
          <Avatar src={user?.avatar} name={user?.name} size="sm" ring />
        </button>
      </div>
    </header>
  );
}
