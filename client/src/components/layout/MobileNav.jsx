import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Phone,
  CircleDashed,
  Users,
  LayoutGrid,
  Users2,
  CalendarClock,
  Contact,
  Star,
  Megaphone,
  Store,
  LayoutDashboard,
  Code2,
  Blocks,
  Settings,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { CountBadge } from '../ui/Badge';
import { useChat } from '../../store/useChat';
import { useUI } from '../../store/useUI';
import { useAuth } from '../../store/useAuth';
import { useWorkspace } from '../../store/useWorkspace';
import { cn } from '../../lib/utils';

// Four primary destinations plus More. The bar can hold five 68px targets on a
// 320px screen and no more, and NavRail (which carries all twelve) is desktop
// only — so everything that doesn't fit here has to live behind More, or it is
// simply unreachable on a phone.
const tabs = [
  { to: '/', icon: MessageSquare, label: 'Chats' },
  { to: '/calls', icon: Phone, label: 'Calls' },
  { to: '/status', icon: CircleDashed, label: 'Status' },
  { to: '/groups', icon: Users, label: 'Groups' },
];

export default function MobileNav() {
  const totalUnread = useChat((s) => s.chats.reduce((n, c) => n + (c.unreadCount || 0), 0));
  const activeChatId = useChat((s) => s.activeChatId);
  const chatListOpen = useUI((s) => s.chatListOpen);
  const openModal = useUI((s) => s.openModal);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const wsType = useWorkspace((s) => s.workspace?.type);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  // Same gating as NavRail: business tools are team-workspace only, and the
  // admin surfaces are role-gated. Offering a link the server will refuse is
  // worse than not offering it.
  const isTeam = wsType && wsType !== 'personal';
  const isAdmin = user?.role === 'admin';
  const more = [
    { to: '/meetings', icon: CalendarClock, label: 'Meetings', hint: 'Schedule and join calls' },
    { to: '/communities', icon: Users2, label: 'Communities', hint: 'Circles you belong to' },
    { to: '/contacts', icon: Contact, label: 'Contacts', hint: 'People and requests' },
    { to: '/starred', icon: Star, label: 'Starred', hint: 'Messages you saved' },
    { to: '/broadcasts', icon: Megaphone, label: 'Broadcast lists', hint: 'Send to many at once' },
    ...(isTeam ? [{ to: '/business', icon: Store, label: 'Business', hint: 'Catalog, labels, replies' }] : []),
    ...(isAdmin ? [{ to: '/admin', icon: LayoutDashboard, label: 'Admin', hint: 'Workspace dashboard' }] : []),
    ...(isAdmin ? [{ to: '/platform', icon: Blocks, label: 'Embed platform', hint: 'Apps, capabilities, secrets' }] : []),
    ...(isAdmin ? [{ to: '/developers', icon: Code2, label: 'Developers', hint: 'API keys and webhooks' }] : []),
    { to: '/settings', icon: Settings, label: 'Settings', hint: 'Appearance, privacy, account' },
  ];

  // While a conversation is open on a phone, the bottom nav gives way to the
  // message composer — the same thing WhatsApp/Telegram do. Two reasons:
  // the composer is the only bottom-anchored control that matters in that view,
  // and stacking a 68px fixed bar under it is what buried the text input.
  // ChatsPage shows the conversation (rather than the list) under exactly this
  // condition, so the two stay in lockstep.
  const conversationOpen = Boolean(activeChatId) && !chatListOpen;
  if (conversationOpen) return null;

  // More owns the highlight whenever you're on one of the routes it holds,
  // otherwise a whole section of the app looks like "nowhere".
  const moreActive = more.some((m) => pathname === m.to || pathname.startsWith(`${m.to}/`));

  const go = (to) => {
    setMoreOpen(false);
    navigate(to);
  };

  return (
    <>
      {/* Height is 68px *plus* the safe-area inset, not 68px total: with
          border-box, `h-[68px]` + a 34px iOS inset left the items only 34px to sit
          in. This also matches AppLayout's content padding exactly. */}
      <nav className="frost neu-rail-top fixed inset-x-0 bottom-0 z-30 flex h-[calc(68px+env(safe-area-inset-bottom))] items-center justify-around border-t border-border px-1 pb-[env(safe-area-inset-bottom)] xs:px-2 md:hidden">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2">
            {({ isActive }) => (
              <>
                {/* Selected = pressed in. In a soft-UI language that reads more
                    immediately than a colour change alone, which is all the
                    active tab used to get. */}
                <span className={cn('relative grid h-9 w-9 place-items-center rounded-full transition-all', isActive && 'neu-inset-sm bg-surface-2')}>
                  <Icon size={22} className={cn('transition-colors', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted')} strokeWidth={isActive ? 2.4 : 2} />
                  {to === '/' && (
                    <span className="absolute -right-2 -top-1.5">
                      <CountBadge count={totalUnread} className="h-4 min-w-[16px] px-1 text-[10px]" />
                    </span>
                  )}
                </span>
                <span className={cn('whitespace-nowrap text-[10px] font-medium leading-none transition-colors', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted')}>{label}</span>
                {isActive && <motion.span layoutId="mnav" className="absolute -top-px h-0.5 w-8 rounded-full bg-brand-gradient" />}
              </>
            )}
          </NavLink>
        ))}

        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More destinations"
          aria-expanded={moreOpen}
          className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2"
        >
          <span className={cn('relative grid h-9 w-9 place-items-center rounded-full transition-all', (moreActive || moreOpen) && 'neu-inset-sm bg-surface-2')}>
            <LayoutGrid size={22} className={cn('transition-colors', moreActive || moreOpen ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted')} strokeWidth={moreActive ? 2.4 : 2} />
          </span>
          <span className={cn('whitespace-nowrap text-[10px] font-medium leading-none transition-colors', moreActive || moreOpen ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted')}>More</span>
          {moreActive && <motion.span layoutId="mnav" className="absolute -top-px h-0.5 w-8 rounded-full bg-brand-gradient" />}
        </button>
      </nav>

      {/* Modal is already a bottom sheet on phones — it brings the backdrop,
          Escape handling, scroll lock and home-indicator padding with it. */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More" subtitle="Everything else in ChatKonect" size="sm">
        <div className="space-y-1.5 pb-2">
          {more.map(({ to, icon: Icon, label, hint }) => {
            const active = pathname === to || pathname.startsWith(`${to}/`);
            return (
              <button
                key={to}
                onClick={() => go(to)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left',
                  active ? 'neu-inset-sm bg-surface-2' : 'neu-hover'
                )}
              >
                <span className="neu-inset grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-content">{label}</span>
                  <span className="block truncate text-xs text-content-muted">{hint}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-content-muted" />
              </button>
            );
          })}

          <div className="my-2 h-px bg-border" />

          <button
            onClick={() => { setMoreOpen(false); openModal('profile', user); }}
            className="neu-hover flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left"
          >
            <span className="neu-inset grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <Contact size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-content">{user?.name || 'Your profile'}</span>
              <span className="block truncate text-xs text-content-muted">{user?.username ? `@${user.username}` : 'View and edit your profile'}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-content-muted" />
          </button>

          <button
            onClick={() => { setMoreOpen(false); logout(); }}
            className="neu-press flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left text-red-500 hover:bg-red-500/10"
          >
            <span className="neu-inset grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-500">
              <LogOut size={18} />
            </span>
            <span className="text-sm font-semibold">Log out</span>
          </button>
        </div>
      </Modal>
    </>
  );
}
