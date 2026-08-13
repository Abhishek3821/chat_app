import { AnimatePresence, motion } from 'framer-motion';
import { X, Bell, Star, Image as ImageIcon, Ban, Flag, Trash2, LogOut, Users, ChevronRight, Link2, Clock, QrCode as QrCodeIcon, Lock, Palette, UserPlus, UserMinus, Check, Search, MoreVertical, ShieldCheck, ShieldOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { ToggleRow } from '../ui/Switch';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useContacts } from '../../store/useContacts';
import { WALLPAPERS } from '../../lib/wallpapers';
import { useEffect, useState } from 'react';
import { getChatDisplay } from '../../lib/chat';
import { USER_MAP } from '../../lib/demoData';
import { cn } from '../../lib/utils';
import { inviteUrlForGroup } from '../../lib/invite';
import InviteQrModal from '../InviteQrModal';
import { DEMO_MODE } from '../../lib/api';
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
  const [qrOpen, setQrOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The member whose actions sheet is open. A MODAL rather than a per-row
  // dropdown on purpose: this list lives inside the panel's scroller, and an
  // absolutely-positioned menu in there gets clipped and scrolls away from its
  // trigger.
  const [memberAction, setMemberAction] = useState(null);
  const [savingRole, setSavingRole] = useState(false);
  const setGroupMemberRole = useChat((s) => s.setGroupMemberRole);
  const removeGroupMember = useChat((s) => s.removeGroupMember);
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

  /* Who may grow the roster: the same per-chat roles the server's GROUP_MANAGE
     gate accepts (utils/rbac.js). Demo chats carry no participant roles, so fall
     back to `createdBy` there rather than hiding the control entirely. */
  const myRole = (chat?.participants || []).find(
    (p) => String(p.user?._id || p.user) === String(currentUser?._id)
  )?.role;
  const canManageMembers =
    !!chat?.isGroup &&
    (myRole === 'owner' || myRole === 'admin' || (!myRole && String(chat?.createdBy) === String(currentUser?._id)));
  const memberIds = new Set(members.map((m) => String(m._id)));
  const isOwner = (m) => m.role === 'owner' || String(m._id) === String(chat?.createdBy);
  /* The server protects the owner's role and refuses to remove them, and you
     leave a group via "Exit group" rather than removing yourself — so neither
     row has an action worth offering. */
  const canActOn = (m) => canManageMembers && !isOwner(m) && String(m._id) !== String(currentUser?._id);

  // Goes to the real screen now. This used to fetch the list purely to count it
  // and report the number in a toast, then throw every row away.
  const openStarred = () => {
    setRightPanel(false);
    navigate('/starred');
  };

  /* ── Wallpaper ── */
  const setChatTheme = useChat((s) => s.setChatTheme);
  const theme = useUI((s) => s.theme);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  // Was `${origin}/join/${chat._id}` — a dead link twice over: there is no /join
  // route, and the server's join endpoint keys off `inviteCode`, not the chat id.
  const inviteUrl = inviteUrlForGroup(chat?.inviteCode);

  const copyInvite = async () => {
    if (!inviteUrl) {
      toast.error('This group has no invite code yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invite link copied');
    } catch {
      toast(inviteUrl);
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

  /* Promote/demote and remove. A promoted member gains GROUP_MEMBERS, so they
     can add people to the group too — which is the whole point of the role. */
  const changeRole = async (role) => {
    const m = memberAction;
    setSavingRole(true);
    try {
      await setGroupMemberRole(chat._id, m._id, role);
      toast.success(role === 'admin' ? `${m.name} is now a group admin` : `${m.name} is no longer an admin`);
      setMemberAction(null);
    } catch (err) {
      toast.error(err?.message || 'Could not change their role.');
    } finally {
      setSavingRole(false);
    }
  };

  const removeMember = async () => {
    const m = memberAction;
    if (!window.confirm(`Remove ${m.name} from ${d.name}?`)) return;
    setSavingRole(true);
    try {
      await removeGroupMember(chat._id, m._id);
      toast.success(`${m.name} was removed`);
      setMemberAction(null);
    } catch (err) {
      toast.error(err?.message || 'Could not remove them.');
    } finally {
      setSavingRole(false);
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
    <div className="flex h-full w-full min-w-0 flex-col bg-surface">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-3 sm:px-4">
        <p className="min-w-0 truncate font-semibold text-content">{chat?.isGroup ? 'Group info' : 'Contact info'}</p>
        <button onClick={() => setRightPanel(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-content-muted hover:bg-content/5 sm:h-9 sm:w-9"><X size={18} /></button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-safe">
        {/* Profile */}
        <div className="flex flex-col items-center gap-3 px-5 py-6 text-center sm:px-6">
          <Avatar src={d.avatar} name={d.name} size="2xl" ring online={d.isGroup ? undefined : d.isOnline} />
          <div className="min-w-0 max-w-full">
            <h3 className="break-words text-lg font-bold text-content">{d.name}</h3>
            <p className="break-words text-sm text-content-muted">{chat?.isGroup ? d.subtitle : d.peer?.bio || (d.isOnline ? 'online' : 'offline')}</p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="px-3 sm:px-4">
          <div className="glass rounded-2xl px-4">
            <ToggleRow title="Mute notifications" icon={Bell} checked={muted} onChange={handleMute} />
          </div>
        </div>

        {/* Wallpaper */}
        <Section title="Wallpaper" icon={Palette}>
          <p className="mb-2.5 text-xs text-content-muted">
            Only you see this — it doesn’t change the wallpaper for anyone else in the chat.
          </p>
          <div className="grid grid-cols-4 gap-2 xs:grid-cols-5">
            {WALLPAPERS.map((w) => {
              const active = (chat?.wallpaper || '') === w.id;
              const preview = isDark ? w.dark : w.light;
              return (
                <button
                  key={w.id || 'default'}
                  onClick={() => {
                    setChatTheme(chat._id, w.id, chat?.bubble || '');
                    toast.success(w.id ? `Wallpaper: ${w.name}` : 'Wallpaper cleared');
                  }}
                  title={w.name}
                  aria-label={`Use the ${w.name} wallpaper`}
                  aria-pressed={active}
                  className={cn(
                    'ring-brand aspect-square rounded-xl border-2 transition-all',
                    active ? 'border-brand-500 scale-105' : 'border-border hover:border-brand-500/40',
                    !w.id && 'bg-surface-2'
                  )}
                  style={preview}
                />
              );
            })}
          </div>
        </Section>

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
                    active ? 'border-brand-500 neu-inset bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-border text-content-muted hover:bg-content/5'
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
            <button onClick={() => setQrOpen(true)} className="flex w-full items-center gap-3 px-6 py-3 hover:bg-content/5">
              <QrCodeIcon size={18} className="text-brand-500" />
              <span className="text-sm font-medium text-content">Invite via QR code</span>
              <ChevronRight size={16} className="ml-auto text-content-muted" />
            </button>
            <Section
              title={`${members.length} members`}
              icon={Users}
              action={
                canManageMembers ? (
                  <button
                    onClick={() => setAddOpen(true)}
                    className="ring-brand -my-1 flex items-center gap-1 rounded-full px-2 py-1 font-medium text-brand-500 hover:bg-brand-500/10"
                  >
                    <UserPlus size={14} /> Add
                  </button>
                ) : null
              }
            >
              <div className="space-y-1">
                {members.map((m) => (
                  <div key={m._id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-content/5">
                    <Avatar src={m.avatar} name={m.name} size="sm" online={m.isOnline} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">{m.name}</p>
                      <p className="truncate text-xs text-content-muted">@{m.username}</p>
                    </div>
                    {(isOwner(m) || m.role === 'admin') && (
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-500">
                        {isOwner(m) ? 'owner' : 'admin'}
                      </span>
                    )}
                    {canActOn(m) && (
                      <button
                        onClick={() => setMemberAction(m)}
                        aria-label={`Manage ${m.name}`}
                        className="ring-brand grid h-8 w-8 shrink-0 place-items-center rounded-lg text-content-muted hover:bg-content/10"
                      >
                        <MoreVertical size={16} />
                      </button>
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
      {/* Desktop: inline animated column. Gated at xl, not lg — at 1024px the
          76px rail + 380px chat list + this 360px column left the conversation
          barely 200px wide. Below xl the drawer below takes over instead. */}
      <AnimatePresence>
        {rightPanelOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
            className="hidden shrink-0 overflow-hidden border-l border-border xl:block"
          >
            <div className="h-full w-[360px]">{panel}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile/tablet: overlay drawer */}
      <AnimatePresence>
        {rightPanelOpen && (
          <div className="fixed inset-0 z-40 xl:hidden">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRightPanel(false)} className="absolute inset-0 bg-black/50" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} className="absolute right-0 top-0 h-full w-full max-w-sm md:max-w-md">
              {panel}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Member actions */}
      <Modal
        open={!!memberAction}
        onClose={() => !savingRole && setMemberAction(null)}
        title={memberAction?.name || ''}
        subtitle={memberAction?.role === 'admin' ? 'Group admin' : 'Member'}
        size="sm"
      >
        <div className="space-y-2 pb-4 pt-1">
          {memberAction?.role === 'admin' ? (
            <ActionRow icon={ShieldOff} label="Dismiss as admin" disabled={savingRole} onClick={() => changeRole('member')} />
          ) : (
            <ActionRow
              icon={ShieldCheck}
              label="Make group admin"
              hint="They'll be able to add members and edit the group."
              disabled={savingRole}
              onClick={() => changeRole('admin')}
            />
          )}
          <ActionRow icon={UserMinus} label="Remove from group" danger disabled={savingRole} onClick={removeMember} />
        </div>
      </Modal>

      <AddMembersModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        chatId={chat?._id}
        groupName={d.name}
        memberIds={memberIds}
      />

      <InviteQrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`Invite to ${d.name}`}
        description="Anyone who scans this joins the group."
        url={inviteUrl}
      />

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
              className="neu-raised-sm neu-press flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3 text-left text-sm font-medium text-content disabled:opacity-60"
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

/** One row in the member-actions sheet — matches the report-reason rows above. */
function ActionRow({ icon: Icon, label, hint, danger, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'neu-raised-sm neu-press flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left disabled:opacity-60',
        danger ? 'text-red-500' : 'text-content'
      )}
    >
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-content-muted">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Pick contacts to add to a group the viewer owns or administers.
 *
 * People already in the group are filtered out rather than shown greyed, so the
 * list only ever offers something that will actually do anything. The server can
 * still refuse an invitee (their "who can add me to groups" setting, or a
 * block); those come back in `skipped` and are named here — silently returning a
 * shorter roster is exactly the failure this whole flow exists to avoid.
 */
function AddMembersModal({ open, onClose, chatId, groupName, memberIds }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const { contacts, load } = useContacts();
  const addGroupMembers = useChat((s) => s.addGroupMembers);

  useEffect(() => {
    if (open) load();
    else {
      setQ('');
      setPicked([]);
    }
  }, [open, load]);

  const term = q.trim().toLowerCase();
  const candidates = contacts.filter(
    (u) => !memberIds.has(String(u._id)) && `${u.name} ${u.username} ${u.email || ''}`.toLowerCase().includes(term)
  );
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    if (!picked.length) return;
    setSaving(true);
    try {
      const { skipped } = await addGroupMembers(chatId, picked);
      const addedCount = picked.length - (skipped?.length || 0);
      if (addedCount > 0) toast.success(`Added ${addedCount} to ${groupName}`);
      if (skipped?.length) {
        const named = skipped.filter((s) => s.name).map((s) => s.name);
        const who = named.length ? named.join(', ') : `${skipped.length} of them`;
        toast(`${who} couldn't be added — their privacy settings don't allow it.`, { icon: '🔒' });
      }
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Could not add members.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Add members"
      subtitle={`Pick contacts to add to ${groupName}`}
      footer={
        <Button className="w-full" onClick={submit} disabled={saving || picked.length === 0}>
          <UserPlus size={16} />
          {saving ? 'Adding…' : picked.length ? `Add ${picked.length}` : 'Add members'}
        </Button>
      }
    >
      <Input icon={Search} placeholder="Search your contacts" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="scrollbar-thin max-h-72 space-y-0.5 overflow-y-auto pb-2">
        {candidates.map((u) => {
          const selected = picked.includes(u._id);
          return (
            <button
              key={u._id}
              onClick={() => toggle(u._id)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-content/5"
            >
              <Avatar src={u.avatar} name={u.name} size="md" online={u.isOnline} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content">{u.name}</p>
                <p className="truncate text-xs text-content-muted">@{u.username}</p>
              </div>
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full border-2 transition-colors',
                  selected ? 'border-brand-500 bg-brand-gradient text-white' : 'border-border'
                )}
              >
                {selected && <Check size={14} />}
              </span>
            </button>
          );
        })}
        {candidates.length === 0 && (
          <p className="py-8 text-center text-sm text-content-muted">
            {term
              ? 'No contacts match that search.'
              : contacts.length
                ? 'Everyone in your contacts is already in this group.'
                : 'No contacts yet — add people in Contacts first.'}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, icon: Icon, action, children }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        {Icon && <Icon size={15} className="text-content-muted" />}
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">{title}</p>
        {/* Rendered as-is rather than wrapped in a <button>: this used to wrap it
            in a button with no onClick, so any caller passing `action` would get
            a control that looks clickable and does nothing. Callers pass their
            own interactive element (or plain text) and own its behaviour. */}
        {action && <span className="ml-auto text-xs font-medium text-brand-500">{action}</span>}
      </div>
      {children}
    </div>
  );
}
