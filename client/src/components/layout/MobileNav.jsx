import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, Phone, CircleDashed, Users, Users2 } from 'lucide-react';
import { CountBadge } from '../ui/Badge';
import { useChat } from '../../store/useChat';
import { cn } from '../../lib/utils';

const items = [
  { to: '/', icon: MessageSquare, label: 'Chats' },
  { to: '/calls', icon: Phone, label: 'Calls' },
  { to: '/status', icon: CircleDashed, label: 'Status' },
  { to: '/groups', icon: Users, label: 'Groups' },
  { to: '/communities', icon: Users2, label: 'Circles' },
];

export default function MobileNav() {
  const totalUnread = useChat((s) => s.chats.reduce((n, c) => n + (c.unreadCount || 0), 0));

  return (
    <nav className="glass-strong fixed inset-x-0 bottom-0 z-30 flex h-[68px] items-center justify-around border-t border-border px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to} end={to === '/'} className="relative flex flex-1 flex-col items-center gap-0.5 py-2">
          {({ isActive }) => (
            <>
              <span className="relative">
                <Icon size={22} className={cn('transition-colors', isActive ? 'text-brand-500' : 'text-content-muted')} strokeWidth={isActive ? 2.4 : 2} />
                {to === '/' && (
                  <span className="absolute -right-2 -top-1.5">
                    <CountBadge count={totalUnread} className="h-4 min-w-[16px] text-[9px]" />
                  </span>
                )}
              </span>
              <span className={cn('text-[10px] font-medium transition-colors', isActive ? 'text-brand-500' : 'text-content-muted')}>{label}</span>
              {isActive && <motion.span layoutId="mnav" className="absolute -top-px h-0.5 w-8 rounded-full bg-brand-gradient" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
