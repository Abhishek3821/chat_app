import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Search, Check, Users, Video, Phone, Calendar, Clock, Image as ImageIcon, Type, MessageSquare, UserPlus, Forward, Globe, Mail, X, Plus } from 'lucide-react';
import Modal from '../ui/Modal';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { Input, Field, Textarea } from '../ui/Input';
import Switch from '../ui/Switch';
import { Chip } from '../ui/Badge';

// Full IANA zone list where the browser supports it, else a sensible short list.
const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
const BROWSER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();
const EMAIL_RE = /^\S+@\S+\.\S+$/;
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useAuth } from '../../store/useAuth';
import { useContacts } from '../../store/useContacts';
import { useMeetings } from '../../store/useMeetings';
import { useStatus } from '../../store/useStatus';
import { USERS } from '../../lib/demoData';
import { getChatDisplay } from '../../lib/chat';
import { cn } from '../../lib/utils';

export default function ModalHost() {
  const { activeModal, modalData, closeModal } = useUI();
  return (
    <>
      <NewChatModal open={activeModal === 'newChat'} onClose={closeModal} />
      <CreateGroupModal open={activeModal === 'createGroup'} onClose={closeModal} />
      <ScheduleMeetingModal open={activeModal === 'scheduleMeeting'} onClose={closeModal} />
      <EditProfileModal open={activeModal === 'editProfile'} onClose={closeModal} />
      <NewStatusModal open={activeModal === 'newStatus'} onClose={closeModal} />
      <ProfileModal open={activeModal === 'profile'} onClose={closeModal} user={modalData} />
      <ForwardMessageModal open={activeModal === 'forwardMessage'} onClose={closeModal} message={modalData?.message} />
    </>
  );
}

function UserPickRow({ user, selected, onToggle, multi }) {
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-content/5">
      <Avatar src={user.avatar} name={user.name} size="md" online={user.isOnline} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-content">{user.name}</p>
        <p className="truncate text-xs text-content-muted">@{user.username}</p>
      </div>
      <span className={cn('grid h-6 w-6 place-items-center rounded-full border-2 transition-colors', selected ? 'border-brand-500 bg-brand-gradient text-white' : 'border-border', !multi && 'rounded-full')}>
        {selected && <Check size={14} />}
      </span>
    </button>
  );
}

function NewChatModal({ open, onClose }) {
  const [q, setQ] = useState('');
  const { contacts, load, startChat } = useContacts();
  const { openModal, setChatListOpen } = useUI();

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const list = contacts.filter((u) => `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  const start = async (user) => {
    try {
      await startChat(user);
      setChatListOpen(false);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not open chat');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New chat" subtitle="Start a conversation with a contact">
      <Input icon={Search} placeholder="Search your contacts" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="space-y-0.5 pb-4">
        {list.map((u) => (
          <UserPickRow key={u._id} user={u} selected={false} onToggle={() => start(u)} />
        ))}
        {list.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-content-muted">No contacts yet.</p>
            <Button variant="subtle" size="sm" className="mt-3" onClick={() => { onClose(); openModal(null); window.location.assign('/contacts'); }}>
              <UserPlus size={16} /> Find people to add
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateGroupModal({ open, onClose }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const createGroup = useChat((s) => s.createGroup);
  const { contacts, load } = useContacts();
  const { setChatListOpen } = useUI();

  useEffect(() => {
    if (open) load();
    if (!open) { setName(''); setDesc(''); setMembers([]); }
  }, [open, load]);

  const toggle = (id) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const create = async () => {
    if (!name.trim()) return toast.error('Give your group a name');
    if (members.length === 0) return toast.error('Add at least one member');
    setSaving(true);
    try {
      await createGroup({ name: name.trim(), description: desc.trim(), members });
      toast.success(`“${name.trim()}” created 🎉`);
      setChatListOpen?.(false);
      onClose();
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Could not create the group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create group"
      subtitle="Bring your people together"
      footer={<Button className="w-full" onClick={create} disabled={saving}><Users size={16} /> {saving ? 'Creating…' : 'Create group'}</Button>}
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow"><Users size={26} /></div>
          <div className="flex-1 space-y-2">
            <Input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <Field label="Description (optional)">
          <Textarea rows={2} placeholder="What's this group about?" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-content">Add members <span className="text-content-muted">({members.length})</span></p>
          <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
            {contacts.length === 0 && <p className="py-6 text-center text-sm text-content-muted">No contacts yet — add people in Contacts first.</p>}
            {contacts.map((u) => (
              <UserPickRow key={u._id} user={u} multi selected={members.includes(u._id)} onToggle={() => toggle(u._id)} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const EMPTY_SCHEDULE = () => ({ title: '', date: '', time: '', type: 'video', recurrence: 'none', timezone: BROWSER_TZ });
const EMPTY_SETTINGS = { joinAnytime: true, muteOnEntry: false, autoRecord: false, askToJoin: true };

function ScheduleMeetingModal({ open, onClose }) {
  const [form, setForm] = useState(EMPTY_SCHEDULE);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [invitees, setInvitees] = useState([]);
  const [emails, setEmails] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const createMeeting = useMeetings((s) => s.create);
  const { contacts, load } = useContacts();

  useEffect(() => {
    if (open) load();
    if (!open) { setForm(EMPTY_SCHEDULE()); setSettings(EMPTY_SETTINGS); setInvitees([]); setEmails([]); setEmailInput(''); }
  }, [open, load]);

  const toggleInvitee = (id) => setInvitees((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const setToggle = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }));

  const addEmail = () => {
    const e = emailInput.trim().toLowerCase();
    if (!e) return;
    if (!EMAIL_RE.test(e)) return toast.error('That doesn’t look like an email.');
    if (!emails.includes(e)) setEmails((list) => [...list, e]);
    setEmailInput('');
  };

  const schedule = async () => {
    if (!form.title.trim()) return toast.error('Add a meeting title');
    if (!form.date || !form.time) return toast.error('Pick a date and time');
    const startAt = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(startAt.getTime())) return toast.error('That date/time looks off');
    setSaving(true);
    try {
      await createMeeting({
        title: form.title.trim(),
        startAt: startAt.toISOString(),
        type: form.type,
        recurrence: form.recurrence,
        timezone: form.timezone,
        participants: invitees,
        inviteEmails: emails,
        settings,
      });
      toast.success('Meeting scheduled 📅');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not schedule the meeting');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule meeting"
      subtitle="Plan an audio or video meeting"
      footer={<Button className="w-full" onClick={schedule} disabled={saving}><Calendar size={16} /> {saving ? 'Scheduling…' : 'Schedule'}</Button>}
    >
      <div className="space-y-4 pb-2">
        <Field label="Title"><Input placeholder="e.g. Design review" value={form.title} onChange={set('title')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" icon={Calendar} value={form.date} onChange={set('date')} /></Field>
          <Field label="Time"><Input type="time" icon={Clock} value={form.time} onChange={set('time')} /></Field>
        </div>
        <Field label="Time zone">
          <div className="relative">
            <Globe className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-content-muted" size={16} />
            <select
              value={form.timezone}
              onChange={set('timezone')}
              className="ring-brand h-11 w-full appearance-none rounded-xl border border-border bg-surface-2 pl-10 pr-3 text-sm text-content"
            >
              {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>))}
            </select>
          </div>
        </Field>
        <Field label="Type">
          <div className="flex gap-2">
            <TypeChip active={form.type === 'video'} onClick={() => setForm((f) => ({ ...f, type: 'video' }))} icon={Video} label="Video" />
            <TypeChip active={form.type === 'audio'} onClick={() => setForm((f) => ({ ...f, type: 'audio' }))} icon={Phone} label="Audio" />
          </div>
        </Field>
        <Field label="Repeat">
          <div className="flex flex-wrap gap-2">
            {['none', 'daily', 'weekly', 'monthly'].map((r) => (
              <Chip key={r} active={form.recurrence === r} onClick={() => setForm((f) => ({ ...f, recurrence: r }))}>{r === 'none' ? "Doesn't repeat" : r}</Chip>
            ))}
          </div>
        </Field>

        {/* Host controls — enforced for participants who join. */}
        <div className="rounded-2xl border border-border bg-surface-2/40 px-3.5 py-1">
          <ToggleLine label="Let participants join anytime" hint="Off = they wait until you (the host) join." checked={settings.joinAnytime} onChange={setToggle('joinAnytime')} />
          <ToggleLine label="Ask to join" hint="People you didn't invite must knock and be admitted by you." checked={settings.askToJoin} onChange={setToggle('askToJoin')} />
          <ToggleLine label="Mute participants on entry" hint="Everyone but you joins muted." checked={settings.muteOnEntry} onChange={setToggle('muteOnEntry')} />
          <ToggleLine label="Auto-record on join" hint="Each participant's device records locally." checked={settings.autoRecord} onChange={setToggle('autoRecord')} />
        </div>

        {/* Invite by email (registered or not — they get the link). */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content"><Mail size={15} /> Invite by email</p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="name@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            />
            <Button type="button" variant="subtle" size="md" onClick={addEmail}><Plus size={16} /></Button>
          </div>
          {emails.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {emails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 py-1 pl-2.5 pr-1.5 text-xs text-brand-600 dark:text-brand-300">
                  {e}
                  <button onClick={() => setEmails((list) => list.filter((x) => x !== e))} className="grid h-4 w-4 place-items-center rounded-full hover:bg-brand-500/20"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-content">Invite contacts <span className="text-content-muted">({invitees.length})</span></p>
          <div className="scrollbar-thin max-h-40 space-y-0.5 overflow-y-auto">
            {contacts.length === 0 && <p className="py-4 text-center text-xs text-content-muted">Add contacts to invite them.</p>}
            {contacts.map((u) => (
              <UserPickRow key={u._id} user={u} multi selected={invitees.includes(u._id)} onToggle={() => toggleInvitee(u._id)} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ToggleLine({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-content">{label}</p>
        {hint && <p className="text-xs text-content-muted">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function TypeChip({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition-colors', active ? 'border-transparent bg-brand-gradient text-white shadow-glow' : 'border-border text-content-muted hover:text-content')}>
      <Icon size={16} /> {label}
    </button>
  );
}

/** Downscale a picked image to a small JPEG data URL (avatars stay tiny + render
 *  everywhere without a media token). */
function imageToAvatarDataURL(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function EditProfileModal({ open, onClose }) {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({ name: '', username: '', phone: '', bio: '', avatar: '' });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ModalHost stays mounted for the whole session, so re-sync the form from the
  // live user each time the modal opens (otherwise it shows stale/abandoned data).
  useEffect(() => {
    if (open) setForm({ name: user?.name || '', username: user?.username || '', phone: user?.phone || '', bio: user?.bio || '', avatar: user?.avatar || '' });
  }, [open, user]);

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image.');
    try {
      const avatar = await imageToAvatarDataURL(file);
      setForm((f) => ({ ...f, avatar }));
    } catch {
      toast.error('Could not read that image.');
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      await updateProfile({ name: form.name.trim(), username: form.username.trim(), phone: form.phone.trim(), bio: form.bio, avatar: form.avatar });
      toast.success('Profile updated');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit profile" footer={<Button className="w-full" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>}>
      <div className="space-y-4 pb-2">
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="relative">
            <Avatar src={form.avatar} name={form.name} size="2xl" ring />
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
            <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-brand-gradient text-white shadow-glow" aria-label="Change photo"><ImageIcon size={15} /></button>
          </div>
          <button onClick={() => fileRef.current?.click()} className="text-xs font-medium text-brand-500 hover:text-brand-400">Change photo</button>
        </div>
        <Field label="Name"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Username"><Input value={form.username} onChange={set('username')} /></Field>
        <Field label="Phone number" hint="Used for login codes and so contacts can find you — one account per number.">
          <Input type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="About"><Textarea rows={2} value={form.bio} onChange={set('bio')} /></Field>
      </div>
    </Modal>
  );
}

const BACKGROUNDS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)',
  'linear-gradient(135deg,#f59e0b,#ec4899)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#f97316,#ef4444)',
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#0ea5e9,#6366f1)',
];

function NewStatusModal({ open, onClose }) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BACKGROUNDS[0]);
  const postStatus = useStatus((s) => s.post);

  const post = async () => {
    if (!text.trim()) return toast.error('Write something first');
    try {
      await postStatus({ content: text.trim(), background: bg, type: 'text' });
      toast.success('Status posted — visible for 24h');
      setText('');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not post status');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New status" subtitle="Share a moment for 24 hours" footer={<Button className="w-full" onClick={post}>Post status</Button>}>
      <div className="space-y-4 pb-2">
        <div className="grid aspect-video place-items-center rounded-2xl p-6 text-center shadow-soft" style={{ background: bg }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a status…" maxLength={140} className="w-full resize-none bg-transparent text-center text-xl font-bold text-white outline-none placeholder:text-white/70" rows={3} />
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content"><Type size={15} /> Background</p>
          <div className="flex flex-wrap gap-2">
            {BACKGROUNDS.map((b) => (
              <button key={b} onClick={() => setBg(b)} className={cn('h-10 w-10 rounded-full ring-2 ring-offset-2 ring-offset-surface transition-all', bg === b ? 'ring-brand-500' : 'ring-transparent')} style={{ background: b }} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ProfileModal({ open, onClose, user }) {
  const { startCall } = useUI();
  const openDirectChat = useChat((s) => s.openDirectChat);
  const navigate = useNavigate();
  if (!user) return null;
  const message = async () => {
    onClose();
    try {
      if (user._id) await openDirectChat(user._id);
    } catch {
      /* still navigate to the chat home */
    }
    navigate('/');
  };
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center gap-3 pb-4 pt-2 text-center">
        <Avatar src={user.avatar} name={user.name} size="2xl" ring online={user.isOnline} />
        <div>
          <h3 className="text-xl font-bold text-content">{user.name}</h3>
          <p className="text-sm text-content-muted">@{user.username}</p>
        </div>
        <p className="text-sm text-content">{user.bio}</p>
        {user.email && <p className="text-xs text-content-muted">{user.email}</p>}
        {user.phone && <p className="text-xs text-content-muted">{user.phone}</p>}
        <div className="mt-2 flex gap-2">
          <Button variant="subtle" size="sm" onClick={message}><MessageSquare size={16} /> Message</Button>
          <Button variant="glass" size="icon-sm" onClick={() => { startCall({ type: 'audio', peer: user, direction: 'outgoing' }); onClose(); }}><Phone size={16} /></Button>
          <Button variant="glass" size="icon-sm" onClick={() => { startCall({ type: 'video', peer: user, direction: 'outgoing' }); onClose(); }}><Video size={16} /></Button>
        </div>
      </div>
    </Modal>
  );
}

function ForwardMessageModal({ open, onClose, message }) {
  const chats = useChat((s) => s.chats);
  const forwardMessage = useChat((s) => s.forwardMessage);
  const me = useAuth((s) => s.user);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked([]);
      setQ('');
    }
  }, [open]);

  const list = chats
    .map((c) => ({ chat: c, d: getChatDisplay(c, me) }))
    .filter(({ d }) => (d.name || '').toLowerCase().includes(q.toLowerCase()));

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const doForward = async () => {
    if (!picked.length || !message) return;
    setBusy(true);
    try {
      await forwardMessage(message, picked);
      toast.success(`Forwarded to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
      onClose();
    } catch {
      toast.error('Could not forward the message');
    } finally {
      setBusy(false);
    }
  };

  const preview = message?.content || (message?.type && message.type !== 'text' ? `[${message.type}]` : '');

  return (
    <Modal open={open} onClose={onClose} title="Forward message" subtitle="Choose chats to forward to">
      {preview && <p className="mb-3 truncate rounded-xl bg-content/5 px-3 py-2 text-sm text-content-muted">“{preview}”</p>}
      <Input icon={Search} placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <div className="max-h-72 space-y-0.5 overflow-y-auto pb-2">
        {list.map(({ chat, d }) => (
          <button key={chat._id} onClick={() => toggle(chat._id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-content/5">
            <Avatar src={d.avatar} name={d.name} size="md" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">{d.name}</span>
            <span className={cn('grid h-6 w-6 place-items-center rounded-full border-2 transition-colors', picked.includes(chat._id) ? 'border-brand-500 bg-brand-gradient text-white' : 'border-border')}>
              {picked.includes(chat._id) && <Check size={14} />}
            </span>
          </button>
        ))}
        {list.length === 0 && <p className="px-2 py-6 text-center text-sm text-content-muted">No chats found.</p>}
      </div>
      <Button onClick={doForward} disabled={!picked.length || busy} className="w-full">
        <Forward size={16} /> {busy ? 'Forwarding…' : `Forward${picked.length ? ` (${picked.length})` : ''}`}
      </Button>
    </Modal>
  );
}
