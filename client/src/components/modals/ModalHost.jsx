import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Search, Check, Users, Video, Phone, Calendar, Clock, Image as ImageIcon, Type, MessageSquare, UserPlus } from 'lucide-react';
import Modal from '../ui/Modal';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { Input, Field, Textarea } from '../ui/Input';
import { Chip } from '../ui/Badge';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useAuth } from '../../store/useAuth';
import { useContacts } from '../../store/useContacts';
import { useStatus } from '../../store/useStatus';
import { USERS } from '../../lib/demoData';
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
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [members, setMembers] = useState([]);
  const { addChat, setActiveChat } = useChat();

  const toggle = (id) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const create = () => {
    if (!name.trim()) return toast.error('Give your group a name');
    if (members.length === 0) return toast.error('Add at least one member');
    const chat = {
      _id: `g-${Date.now()}`,
      isGroup: true,
      name,
      description: desc,
      avatar: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(name)}`,
      members: ['me', ...members],
      unreadCount: 0,
      lastMessage: { content: 'Group created', createdAt: new Date().toISOString(), sender: 'me' },
    };
    addChat(chat);
    setActiveChat(chat._id);
    toast.success(`“${name}” created 🎉`);
    setName(''); setDesc(''); setMembers([]);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create group"
      subtitle="Bring your people together"
      footer={<Button className="w-full" onClick={create}><Users size={16} /> Create group</Button>}
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
            {USERS.map((u) => (
              <UserPickRow key={u._id} user={u} multi selected={members.includes(u._id)} onToggle={() => toggle(u._id)} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleMeetingModal({ open, onClose }) {
  const [form, setForm] = useState({ title: '', date: '', time: '', type: 'video', recurrence: 'none' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const schedule = () => {
    if (!form.title.trim()) return toast.error('Add a meeting title');
    if (!form.date || !form.time) return toast.error('Pick a date and time');
    toast.success('Meeting scheduled 📅');
    onClose();
    setForm({ title: '', date: '', time: '', type: 'video', recurrence: 'none' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule meeting"
      subtitle="Plan an audio or video meeting"
      footer={<Button className="w-full" onClick={schedule}><Calendar size={16} /> Schedule</Button>}
    >
      <div className="space-y-4 pb-2">
        <Field label="Title"><Input placeholder="e.g. Design review" value={form.title} onChange={set('title')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" icon={Calendar} value={form.date} onChange={set('date')} /></Field>
          <Field label="Time"><Input type="time" icon={Clock} value={form.time} onChange={set('time')} /></Field>
        </div>
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
      </div>
    </Modal>
  );
}

function TypeChip({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition-colors', active ? 'border-transparent bg-brand-gradient text-white shadow-glow' : 'border-border text-content-muted hover:text-content')}>
      <Icon size={16} /> {label}
    </button>
  );
}

function EditProfileModal({ open, onClose }) {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({ name: user?.name || '', username: user?.username || '', bio: user?.bio || '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ModalHost stays mounted for the whole session, so re-sync the form from the
  // live user each time the modal opens (otherwise it shows stale/abandoned data).
  useEffect(() => {
    if (open) setForm({ name: user?.name || '', username: user?.username || '', bio: user?.bio || '' });
  }, [open, user]);

  const save = () => {
    updateUser(form);
    toast.success('Profile updated');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit profile" footer={<Button className="w-full" onClick={save}>Save changes</Button>}>
      <div className="space-y-4 pb-2">
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="relative">
            <Avatar src={user?.avatar} name={form.name} size="2xl" ring />
            <button className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-brand-gradient text-white shadow-glow"><ImageIcon size={15} /></button>
          </div>
        </div>
        <Field label="Name"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Username"><Input value={form.username} onChange={set('username')} /></Field>
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
  if (!user) return null;
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
        <div className="mt-2 flex gap-2">
          <Button variant="subtle" size="sm" onClick={onClose}><MessageSquare size={16} /> Message</Button>
          <Button variant="glass" size="icon-sm" onClick={() => { startCall({ type: 'audio', peer: user, direction: 'outgoing' }); onClose(); }}><Phone size={16} /></Button>
          <Button variant="glass" size="icon-sm" onClick={() => { startCall({ type: 'video', peer: user, direction: 'outgoing' }); onClose(); }}><Video size={16} /></Button>
        </div>
      </div>
    </Modal>
  );
}
