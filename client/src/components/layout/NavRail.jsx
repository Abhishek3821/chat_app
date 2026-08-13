import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Phone,
  CalendarClock,
  CircleDashed,
  Users,
  Users2,
  Store,
  Contact,
  Star,
  Settings,
  LayoutDashboard,
  Code2,
  Blocks,
  LogOut,
} from 'lucide-react';
import { LogoMark } from '../brand/Logo';
import Avatar from '../ui/Avatar';
import Tooltip from '../ui/Tooltip';
import { useAuth } from '../../store/useAuth';
import { useUI } from '../../store/useUI';
import { useWorkspace } from '../../store/useWorkspace';
import { cn } from '../../lib/utils';

const baseItems = [
  { to: '/', icon: MessageSquare, label: 'Chats' },
  { to: '/calls', icon: Phone, label: 'Calls' },
  { to: '/meetings', icon: CalendarClock, label: 'Meetings' },
  { to: '/status', icon: CircleDashed, label: 'Status' },
  { to: '/groups', icon: Users, label: 'Groups' },
  { to: '/communities', icon: Users2, label: 'Communities' },
  { to: '/contacts', icon: Contact, label: 'Contacts' },
  { to: '/starred', icon: Star, label: 'Starred' },
];

/** Shared shape for the rail's lower (non-animated) items, so the collapsed
 *  icon-only state and the expanded 2xl state stay in sync in one place. */
const railItem =
  'flex h-12 w-12 items-center justify-center rounded-2xl transition-colors 2xl:w-full 2xl:justify-start 2xl:gap-3 2xl:px-3';
const railLabel = 'hidden truncate text-sm font-semibold 2xl:block';

export default function NavRail() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const openModal = useUI((s) => s.openModal);
  const wsType = useWorkspace((s) => s.workspace?.type);
  const navigate = useNavigate();

  // Business tools only make sense for team workspaces (not the shared Personal space).
  const items = wsType && wsType !== 'personal'
    ? [...baseItems, { to: '/business', icon: Store, label: 'Business' }]
    : baseItems;

  return (
    // Icon-only rail from md up; at 2xl there's room to spare so it expands and
    // labels the destinations inline (2xl was previously unused app-wide).
    <nav className="frost z-30 hidden h-full w-[76px] shrink-0 flex-col items-center gap-1.5 border-r border-border/70 py-4 md:flex 2xl:w-[232px] 2xl:items-stretch 2xl:px-3">
      <button
        onClick={() => navigate('/')}
        className="mb-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform hover:scale-105 2xl:h-12 2xl:w-full 2xl:justify-start 2xl:gap-2.5 2xl:px-2"
        aria-label="ChatKonect home"
      >
        <LogoMark size={34} />
        <span className="hidden text-lg font-extrabold tracking-tight text-content 2xl:block">ChatKonect</span>
      </button>

      {/* min-h-0 + overflow lets the list scroll instead of squashing/overflowing
          on short viewports — a landscape tablet plus the admin/developer items
          adds up to more than the rail is tall. */}
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto 2xl:items-stretch">
        {items.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to} label={label} className="shrink-0 2xl:w-full" labelClassName="2xl:hidden">
            <NavLink to={to} end={to === '/'} className="block 2xl:w-full">
              {({ isActive }) => (
                <span
                  className={cn(
                    'relative flex h-12 w-12 items-center justify-center rounded-2xl transition-colors 2xl:w-full 2xl:justify-start 2xl:gap-3 2xl:px-3',
                    isActive ? 'text-white' : 'neu-hover text-content-muted hover:text-content'
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-2xl bg-brand-gradient shadow-glow-lg"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon className="relative z-10 shrink-0" size={21} strokeWidth={2} />
                  <span className="relative z-10 hidden truncate text-sm font-semibold 2xl:block">{label}</span>
                </span>
              )}
            </NavLink>
          </Tooltip>
        ))}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5 2xl:items-stretch">
        {user?.role === 'admin' && (
          <Tooltip label="Admin" className="2xl:w-full" labelClassName="2xl:hidden">
            <NavLink to="/admin" className="block 2xl:w-full">
              {({ isActive }) => (
                <span className={cn(railItem, isActive ? 'bg-brand-gradient text-white shadow-glow-lg' : 'neu-hover text-content-muted hover:text-content')}>
                  <LayoutDashboard size={21} className="shrink-0" />
                  <span className={railLabel}>Admin</span>
                </span>
              )}
            </NavLink>
          </Tooltip>
        )}
        {user?.role === 'admin' && (
          <Tooltip label="Embed platform" className="2xl:w-full" labelClassName="2xl:hidden">
            <NavLink to="/platform" className="block 2xl:w-full">
              {({ isActive }) => (
                <span className={cn(railItem, isActive ? 'bg-brand-gradient text-white shadow-glow-lg' : 'neu-hover text-content-muted hover:text-content')}>
                  <Blocks size={21} className="shrink-0" />
                  <span className={railLabel}>Platform</span>
                </span>
              )}
            </NavLink>
          </Tooltip>
        )}
        {user?.role === 'admin' && (
          <Tooltip label="Developers" className="2xl:w-full" labelClassName="2xl:hidden">
            <NavLink to="/developers" className="block 2xl:w-full">
              {({ isActive }) => (
                <span className={cn(railItem, isActive ? 'bg-brand-gradient text-white shadow-glow-lg' : 'neu-hover text-content-muted hover:text-content')}>
                  <Code2 size={21} className="shrink-0" />
                  <span className={railLabel}>Developers</span>
                </span>
              )}
            </NavLink>
          </Tooltip>
        )}
        <Tooltip label="Settings" className="2xl:w-full" labelClassName="2xl:hidden">
          <NavLink to="/settings" className="block 2xl:w-full">
            {({ isActive }) => (
              <span className={cn(railItem, isActive ? 'bg-brand-gradient text-white shadow-glow-lg' : 'neu-hover text-content-muted hover:text-content')}>
                <Settings size={21} className="shrink-0" />
                <span className={railLabel}>Settings</span>
              </span>
            )}
          </NavLink>
        </Tooltip>
        <Tooltip label="Log out" className="2xl:w-full" labelClassName="2xl:hidden">
          <button onClick={logout} className={cn(railItem, 'neu-press text-content-muted hover:bg-red-500/10 hover:text-red-500')}>
            <LogOut size={20} className="shrink-0" />
            <span className={railLabel}>Log out</span>
          </button>
        </Tooltip>
        <button
          onClick={() => openModal('profile', user)}
          className="neu-hover mt-1 flex items-center justify-center rounded-2xl p-1.5 2xl:w-full 2xl:justify-start 2xl:gap-3 2xl:px-3 2xl:py-2"
        >
          <Avatar src={user?.avatar} name={user?.name} size="sm" ring />
          <span className="hidden min-w-0 truncate text-sm font-semibold text-content 2xl:block">{user?.name || 'You'}</span>
        </button>
      </div>
    </nav>
  );
}
