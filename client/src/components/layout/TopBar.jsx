import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Sun, Moon, Plus, Check, Download } from 'lucide-react';
import { LogoMark } from '../brand/Logo';
import GlobalSearch from '../search/GlobalSearch';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { CountBadge } from '../ui/Badge';
import { useUI } from '../../store/useUI';
import { useAuth } from '../../store/useAuth';
import { useChat } from '../../store/useChat';
import { useNotifications } from '../../store/useNotifications';
import { formatRelative, cn } from '../../lib/utils';
import { canInstall, promptInstall, onInstallChange } from '../../lib/pwa';

const titles = {
  '/': 'Messages',
  '/calls': 'Calls',
  '/meetings': 'Meetings',
  '/status': 'Status',
  '/groups': 'Groups',
  '/contacts': 'Contacts',
  '/starred': 'Starred',
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
  const [installable, setInstallable] = useState(canInstall());
  const unread = notifs.filter((n) => !n.isRead).length;

  useEffect(() => {
    loadNotifs();
  }, [loadNotifs]);

  useEffect(() => onInstallChange(setInstallable), []);

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
    <header className="frost neu-rail-bottom relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-4 md:px-6">
      <div className="flex items-center gap-2 md:hidden">
        <LogoMark size={30} />
      </div>
      <h1 className="hidden text-xl font-bold text-content md:block">{titles[pathname] || 'ChatKonect'}</h1>

      {/* Inline field from md up (there's room, and it grows with the viewport);
          below that it renders as an icon that opens a full-screen sheet. */}
      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1.5">
        {/* Both of these used to be `hidden sm:inline-flex`, i.e. absent on
            phones. That was backwards for Install (installing to the home
            screen is a phone action above all), and it left New Chat reachable
            only from the chat list's + button — so from any other page on a
            phone you couldn't start one. They collapse to icons instead. */}
        {installable && (
          <Button variant="outline" size="icon-sm" className="sm:hidden" onClick={promptInstall} aria-label="Install ChatKonect as an app" title="Install ChatKonect as an app">
            <Download size={17} />
          </Button>
        )}
        {installable && (
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={promptInstall} title="Install ChatKonect as an app">
            <Download size={16} /> Install app
          </Button>
        )}
        <Button variant="primary" size="icon-sm" className="sm:hidden" onClick={() => openModal('newChat')} aria-label="New chat">
          <Plus size={18} />
        </Button>
        <Button variant="primary" size="sm" className="hidden sm:inline-flex" onClick={() => openModal('newChat')}>
          <Plus size={16} /> New
        </Button>

        <button
          onClick={toggleTheme}
          // 44px minimum touch target on phones, tightened to 40px once there's
          // a pointer instead of a thumb.
          className="neu-raised-sm neu-press ring-brand grid h-11 w-11 place-items-center rounded-full bg-surface text-content-muted hover:text-content sm:h-10 sm:w-10"
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
            className="neu-raised-sm neu-press ring-brand relative grid h-11 w-11 place-items-center rounded-full bg-surface text-content-muted hover:text-content sm:h-10 sm:w-10"
            aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
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
                  // w-80 is exactly 320px, so on a 320-360px phone the panel ran
                  // off the left edge. Cap it to the viewport minus the gutters.
                  className="glass-strong absolute right-0 top-12 z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl sm:w-80"
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
                          <span className="neu-inset grid h-9 w-9 shrink-0 place-items-center rounded-full text-brand-600 dark:text-brand-300"><Bell size={16} /></span>
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
