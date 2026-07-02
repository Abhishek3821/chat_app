import { AnimatePresence, motion } from 'framer-motion';
import { X, Bell, Star, Image as ImageIcon, Ban, Flag, Trash2, LogOut, Users, ChevronRight, Link2 } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { ToggleRow } from '../ui/Switch';
import { useUI } from '../../store/useUI';
import { useState } from 'react';
import { getChatDisplay } from '../../lib/chat';
import { USER_MAP } from '../../lib/demoData';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const MEDIA = Array.from({ length: 6 }).map((_, i) => `https://picsum.photos/seed/cc${i}/200/200`);

export default function RightPanel({ chat, currentUser }) {
  const { rightPanelOpen, setRightPanel } = useUI();
  const [muted, setMuted] = useState(chat?.muted || false);
  const d = getChatDisplay(chat, currentUser);
  const members = chat?.isGroup ? (chat.members || []).map((id) => USER_MAP[id] || currentUser).filter(Boolean) : [];

  const panel = (
    <div className="flex h-full w-full flex-col bg-surface/70 backdrop-blur-xl">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
        <p className="font-semibold text-content">{chat?.isGroup ? 'Group info' : 'Contact info'}</p>
        <button onClick={() => setRightPanel(false)} className="grid h-9 w-9 place-items-center rounded-xl text-content-muted hover:bg-content/5"><X size={18} /></button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {/* Profile */}
        <div className="flex flex-col items-center gap-3 px-6 py-6 text-center">
          <Avatar src={d.avatar} name={d.name} size="2xl" ring online={d.isGroup ? undefined : d.isOnline} />
          <div>
            <h3 className="text-lg font-bold text-content">{d.name}</h3>
            <p className="text-sm text-content-muted">{chat?.isGroup ? d.subtitle : d.peer?.bio || (d.isOnline ? 'online' : 'offline')}</p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="px-4">
          <div className="glass rounded-2xl px-4">
            <ToggleRow title="Mute notifications" icon={Bell} checked={muted} onChange={(v) => { setMuted(v); toast.success(v ? 'Muted' : 'Unmuted'); }} />
          </div>
        </div>

        {/* Shared media */}
        <Section title="Shared media" icon={ImageIcon} action="See all">
          <div className="grid grid-cols-3 gap-1.5">
            {MEDIA.map((src, i) => (
              <motion.img key={i} whileHover={{ scale: 1.05 }} src={src} alt="" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        </Section>

        {/* Starred */}
        <button className="flex w-full items-center gap-3 px-6 py-3 hover:bg-content/5">
          <Star size={18} className="text-amber-500" />
          <span className="text-sm font-medium text-content">Starred messages</span>
          <ChevronRight size={16} className="ml-auto text-content-muted" />
        </button>

        {chat?.isGroup && (
          <>
            <button className="flex w-full items-center gap-3 px-6 py-3 hover:bg-content/5">
              <Link2 size={18} className="text-brand-500" />
              <span className="text-sm font-medium text-content">Invite via link</span>
              <ChevronRight size={16} className="ml-auto text-content-muted" />
            </button>
            <Section title={`${members.length} members`} icon={Users}>
              <div className="space-y-1">
                {members.map((m) => (
                  <div key={m._id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-content/5">
                    <Avatar src={m.avatar} name={m.name} size="sm" online={m.isOnline} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">{m.name}</p>
                      <p className="truncate text-xs text-content-muted">@{m.username}</p>
                    </div>
                    {m._id === (chat.createdBy || 'me') && <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-500">admin</span>}
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {/* Danger actions */}
        <div className="space-y-1 px-4 py-4">
          {[
            { icon: Ban, label: 'Block', danger: true },
            { icon: Flag, label: 'Report', danger: true },
            chat?.isGroup ? { icon: LogOut, label: 'Exit group', danger: true } : { icon: Trash2, label: 'Delete chat', danger: true },
          ].map(({ icon: Icon, label, danger }) => (
            <button key={label} onClick={() => toast.success(`${label} — done`)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-content/5', danger ? 'text-red-500' : 'text-content')}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: inline animated column */}
      <AnimatePresence>
        {rightPanelOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
            className="hidden shrink-0 overflow-hidden border-l border-border lg:block"
          >
            <div className="h-full w-[360px]">{panel}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile/tablet: overlay drawer */}
      <AnimatePresence>
        {rightPanelOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRightPanel(false)} className="absolute inset-0 bg-navy-950/50 backdrop-blur-sm" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} className="absolute right-0 top-0 h-full w-full max-w-sm">
              {panel}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function Section({ title, icon: Icon, action, children }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        {Icon && <Icon size={15} className="text-content-muted" />}
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">{title}</p>
        {action && <button className="ml-auto text-xs font-medium text-brand-500">{action}</button>}
      </div>
      {children}
    </div>
  );
}
