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
  Settings,
  LayoutDashboard,
  Code2,
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
];

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
    <nav className="z-30 hidden h-full w-[76px] shrink-0 flex-col items-center gap-1 border-r border-border bg-surface/60 py-4 backdrop-blur-xl md:flex">
      <button onClick={() => navigate('/')} className="mb-3 grid h-11 w-11 place-items-center rounded-2xl transition-transform hover:scale-105">
        <LogoMark size={34} />
      </button>

      <div className="flex flex-1 flex-col items-center gap-1.5">
        {items.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to} label={label}>
            <NavLink to={to} end={to === '/'} className="block">
              {({ isActive }) => (
                <span
                  className={cn(
                    'relative grid h-12 w-12 place-items-center rounded-2xl transition-colors',
                    isActive ? 'text-white' : 'text-content-muted hover:bg-content/5 hover:text-content'
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-2xl bg-brand-gradient shadow-glow"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon className="relative z-10" size={21} strokeWidth={2} />
                </span>
              )}
            </NavLink>
          </Tooltip>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1.5">
        {user?.role === 'admin' && (
          <Tooltip label="Admin">
            <NavLink to="/admin">
              {({ isActive }) => (
                <span className={cn('grid h-12 w-12 place-items-center rounded-2xl transition-colors', isActive ? 'bg-brand-gradient text-white shadow-glow' : 'text-content-muted hover:bg-content/5 hover:text-content')}>
                  <LayoutDashboard size={21} />
                </span>
              )}
            </NavLink>
          </Tooltip>
        )}
        {user?.role === 'admin' && (
          <Tooltip label="Developers">
            <NavLink to="/developers">
              {({ isActive }) => (
                <span className={cn('grid h-12 w-12 place-items-center rounded-2xl transition-colors', isActive ? 'bg-brand-gradient text-white shadow-glow' : 'text-content-muted hover:bg-content/5 hover:text-content')}>
                  <Code2 size={21} />
                </span>
              )}
            </NavLink>
          </Tooltip>
        )}
        <Tooltip label="Settings">
          <NavLink to="/settings">
            {({ isActive }) => (
              <span className={cn('grid h-12 w-12 place-items-center rounded-2xl transition-colors', isActive ? 'bg-brand-gradient text-white shadow-glow' : 'text-content-muted hover:bg-content/5 hover:text-content')}>
                <Settings size={21} />
              </span>
            )}
          </NavLink>
        </Tooltip>
        <Tooltip label="Log out">
          <button onClick={logout} className="grid h-12 w-12 place-items-center rounded-2xl text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500">
            <LogOut size={20} />
          </button>
        </Tooltip>
        <button onClick={() => openModal('profile', user)} className="mt-1">
          <Avatar src={user?.avatar} name={user?.name} size="sm" ring />
        </button>
      </div>
    </nav>
  );
}
