import { AnimatePresence, motion } from 'framer-motion';
import { X, Bell, Star, Image as ImageIcon, Ban, Flag, Trash2, LogOut, Users, ChevronRight, Link2, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';
import { ToggleRow } from '../ui/Switch';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useContacts } from '../../store/useContacts';
import { useState } from 'react';
import { getChatDisplay } from '../../lib/chat';
import { USER_MAP } from '../../lib/demoData';
import { cn } from '../../lib/utils';
import api, { DEMO_MODE } from '../../lib/api';
import toast from 'react-hot-toast';

const REPORT_REASONS = ['Spam or scam', 'Harassment or bullying', 'Inappropriate content', 'Impersonation', 'Something else'];

const DISAPPEAR_PRESETS = [
  { seconds: 0, label: 'Off' },
  { seconds: 86400, label: '24 hours' },
  { seconds: 604800, label: '7 days' },
  { seconds: 7776000, label: '90 days' },
];

const MEDIA = Array.from({ length: 6 }).map((_, i) => `https://picsum.photos/seed/cc${i}/200/200`);

export default function RightPanel({ chat, currentUser }) {
  const { rightPanelOpen, setRightPanel } = useUI();
  const deleteChat = useChat((s) => s.deleteChat);
  const toggleMuteChat = useChat((s) => s.toggleMute);
  const setDisappearing = useChat((s) => s.setDisappearing);
  const { toggleBlock, report } = useContacts();
  const navigate = useNavigate();
  const [muted, setMuted] = useState(chat?.muted || false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const d = getChatDisplay(chat, currentUser);
  // Real API group chats carry `participants: [{ user, role }]` (user is a
  // populated object). Demo data carries `members: [idString]`. Support both.
  const members = !chat?.isGroup
    ? []
    : Array.isArray(chat.participants) && chat.participants.length
      ? chat.participants
          .map((p) => ({ ...(p.user || {}), role: p.role }))
          .filter((m) => m._id)
      : (chat.members || []).map((id) => USER_MAP[id] || currentUser).filter(Boolean);

  const openStarred = async () => {
    if (DEMO_MODE) return toast('⭐ Starred messages show up here in the full app.');
    try {
      const { data } = await api.get('/messages/starred');
      const list = Array.isArray(data) ? data : data.messages || data.starred || [];
      toast(list.length ? `You have ${list.length} starred message${list.length === 1 ? '' : 's'}.` : 'No starred messages yet.', { icon: '⭐' });
    } catch {
      toast.error('Couldn’t load starred messages.');
    }
  };

  const copyInvite = async () => {
    const link = `${window.location.origin}/join/${chat?._id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied');
    } catch {
      toast(link);
    }
  };

  const handleDeleteChat = async () => {
    const group = chat?.isGroup;
    if (!window.confirm(group ? 'Leave and remove this group from your list?' : 'Delete this conversation?')) return;
    await deleteChat(chat._id);
    toast.success(group ? 'You left the group' : 'Chat deleted');
    setRightPanel(false);
    navigate('/');
  };

  const handleMute = (v) => {
    setMuted(v);
    toggleMuteChat(chat._id); // persists to the account
    toast.success(v ? 'Muted' : 'Unmuted');
  };

  const handleBlock = async () => {
    const peerId = d.peer?._id;
    if (!peerId) return;
    if (!window.confirm(`Block ${d.name}? They won't be able to message or call you.`)) return;
    setBlocking(true);
    try {
      const blocked = await toggleBlock(peerId);
      toast.success(blocked === false ? `${d.name} unblocked` : `${d.name} blocked`);
    } catch (err) {
      toast.error(err?.message || 'Could not block this user.');
    } finally {
      setBlocking(false);
    }
  };

  const submitReport = async (reason) => {
    setReporting(true);
    try {
      await report({
        targetType: chat?.isGroup ? 'group' : 'user',
        targetUser: chat?.isGroup ? undefined : d.peer?._id,
        targetChat: chat?._id,
        reason,
      });
      toast.success('Report submitted — our team will review it.');
      setReportOpen(false);
    } catch (err) {
      toast.error(err?.message || 'Could not submit the report.');
    } finally {
      setReporting(false);
    }
  };

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
            <ToggleRow title="Mute notifications" icon={Bell} checked={muted} onChange={handleMute} />
          </div>
        </div>

        {/* Disappearing messages */}
        <Section title="Disappearing messages" icon={Clock}>
          <div className="flex flex-wrap gap-2">
            {DISAPPEAR_PRESETS.map((p) => {
              const active = (chat?.disappearingSeconds || 0) === p.seconds;
              return (
                <button
                  key={p.seconds}
                  onClick={() => {
                    setDisappearing(chat._id, p.seconds);
                    toast.success(p.seconds ? `New messages disappear after ${p.label}` : 'Disappearing messages off');
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    active ? 'border-brand-500 bg-brand-500/10 text-brand-500' : 'border-border text-content-muted hover:bg-content/5'
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Shared media */}
        <Section title="Shared media" icon={ImageIcon}>
          <div className="grid grid-cols-3 gap-1.5">
            {MEDIA.map((src, i) => (
              <motion.img key={i} whileHover={{ scale: 1.05 }} src={src} alt="" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        </Section>

        {/* Starred */}
        <button onClick={openStarred} className="flex w-full items-center gap-3 px-6 py-3 hover:bg-content/5">
          <Star size={18} className="text-amber-500" />
          <span className="text-sm font-medium text-content">Starred messages</span>
          <ChevronRight size={16} className="ml-auto text-content-muted" />
        </button>

        {chat?.isGroup && (
          <>
            <button onClick={copyInvite} className="flex w-full items-center gap-3 px-6 py-3 hover:bg-content/5">
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
                    {(m.role === 'owner' || m.role === 'admin' || m._id === chat.createdBy) && (
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-500">
                        {m.role === 'owner' || m._id === chat.createdBy ? 'admin' : m.role}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {/* Danger actions */}
        <div className="space-y-1 px-4 py-4">
          {[
            // Blocking only applies to a 1:1 conversation (you block a person).
            !chat?.isGroup && { icon: Ban, label: blocking ? 'Blocking…' : 'Block', onClick: handleBlock, disabled: blocking },
            { icon: Flag, label: 'Report', onClick: () => setReportOpen(true) },
            chat?.isGroup
              ? { icon: LogOut, label: 'Exit group', onClick: handleDeleteChat }
              : { icon: Trash2, label: 'Delete chat', onClick: handleDeleteChat },
          ]
            .filter(Boolean)
            .map(({ icon: Icon, label, onClick, disabled }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={disabled}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-content/5 disabled:opacity-60"
              >
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

      {/* Report reason picker */}
      <Modal
        open={reportOpen}
        onClose={() => !reporting && setReportOpen(false)}
        title={`Report ${chat?.isGroup ? 'group' : d.name}`}
        subtitle="Tell us what's wrong. Reports are confidential."
        size="sm"
      >
        <div className="space-y-2 pb-4 pt-1">
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason}
              disabled={reporting}
              onClick={() => submitReport(reason)}
              className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm font-medium text-content transition-colors hover:bg-content/5 disabled:opacity-60"
            >
              {reason}
              <ChevronRight size={16} className="text-content-muted" />
            </button>
          ))}
        </div>
      </Modal>
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
