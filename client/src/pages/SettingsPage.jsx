import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  User,
  ShieldCheck,
  Bell,
  Palette,
  Settings2,
  Pencil,
  Eye,
  Activity,
  CheckCheck,
  Image as ImageIcon,
  UserPlus,
  MessageSquare,
  Users,
  PhoneCall,
  CalendarClock,
  Volume2,
  Sun,
  Moon,
  Monitor,
  Check,
  Lock,
  Download,
  LogOut,
  Trash2,
  AlertTriangle,
  KeyRound,
  Copy,
  Plus,
  Building2,
  Terminal,
  ExternalLink,
} from 'lucide-react';

import Switch, { ToggleRow } from '@/components/ui/Switch';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Badge';
import { cn, formatRelative } from '@/lib/utils';
import { useUI, ACCENTS } from '@/store/useUI';
import { useAuth } from '@/store/useAuth';
import { useApiKeys } from '@/store/useApiKeys';
import { useWorkspace } from '@/store/useWorkspace';
import { DEMO_MODE } from '@/lib/api';
import { ME } from '@/lib/demoData';

/* Motion presets — matched to the app's existing feel */
const rise = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = { animate: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } };
const panelMotion = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -18 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
};

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'developer', label: 'Developer', icon: KeyRound },
  { id: 'account', label: 'Account', icon: Settings2 },
];

/* ── Shared section shell ─────────────────────────────────────── */
function Section({ title, description, children, className }) {
  return (
    <motion.div variants={rise} className={cn('glass rounded-3xl p-5 shadow-soft sm:p-6', className)}>
      {(title || description) && (
        <div className="mb-2">
          {title && <h3 className="font-display text-base font-bold text-content">{title}</h3>}
          {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
        </div>
      )}
      {children}
    </motion.div>
  );
}

/* Divider between toggle rows */
function Rows({ children }) {
  return <div className="divide-y divide-border">{children}</div>;
}

/* ── Profile ──────────────────────────────────────────────────── */
function ProfilePanel({ user }) {
  const { openModal } = useUI();
  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section className="overflow-hidden">
        {/* Gradient banner */}
        <div className="relative -mx-5 -mt-5 mb-0 h-28 bg-brand-gradient sm:-mx-6 sm:-mt-6">
          <div className="absolute inset-0 bg-mesh-dark opacity-40" />
        </div>

        <div className="relative -mt-12 flex flex-col items-center gap-4 sm:flex-row sm:items-end sm:gap-5">
          <Avatar src={user?.avatar} name={user?.name} size="2xl" online={user?.isOnline} ring className="ring-4 ring-surface" />
          <div className="flex-1 pb-1 text-center sm:pb-2 sm:text-left">
            <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-2">
              <h2 className="font-display text-xl font-extrabold tracking-tight text-content">{user?.name}</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2.5 py-0.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
                @{user?.username}
              </span>
            </div>
            <p className="mt-1 text-sm text-content-muted">{user?.email}</p>
          </div>
          <Button variant="primary" size="md" onClick={() => openModal('editProfile')} className="shrink-0">
            <Pencil size={16} /> Edit profile
          </Button>
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-surface-2/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">About</p>
          <p className="mt-1.5 text-sm leading-relaxed text-content">
            {user?.bio || 'Add a short bio to tell people a little about you.'}
          </p>
        </div>
      </Section>

      <Section title="Profile details" description="How your information appears to others.">
        <Rows>
          <DetailRow icon={User} label="Display name" value={user?.name} />
          <DetailRow icon={UserPlus} label="Username" value={`@${user?.username}`} />
          <DetailRow icon={MessageSquare} label="Email" value={user?.email} />
        </Rows>
      </Section>
    </motion.div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-500">
          <Icon size={18} />
        </span>
        <p className="text-sm font-medium text-content-muted">{label}</p>
      </div>
      <p className="max-w-[55%] truncate text-sm font-semibold text-content">{value}</p>
    </div>
  );
}

/* ── Privacy ──────────────────────────────────────────────────── */
function PrivacyPanel() {
  const [privacy, setPrivacy] = useState({
    lastSeen: true,
    onlineStatus: true,
    readReceipts: true,
    profilePhoto: true,
  });
  const [addToGroups, setAddToGroups] = useState('everyone');

  const toggle = (key, label) => (next) => {
    setPrivacy((p) => ({ ...p, [key]: next }));
    toast.success(`${label} ${next ? 'enabled' : 'disabled'}`);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section title="Visibility" description="Control what other people can see about you.">
        <Rows>
          <ToggleRow
            icon={Eye}
            title="Last seen"
            description="Show when you were last active"
            checked={privacy.lastSeen}
            onChange={toggle('lastSeen', 'Last seen')}
          />
          <ToggleRow
            icon={Activity}
            title="Online status"
            description="Let others see when you're online"
            checked={privacy.onlineStatus}
            onChange={toggle('onlineStatus', 'Online status')}
          />
          <ToggleRow
            icon={CheckCheck}
            title="Read receipts"
            description="Send and receive read confirmations"
            checked={privacy.readReceipts}
            onChange={toggle('readReceipts', 'Read receipts')}
          />
          <ToggleRow
            icon={ImageIcon}
            title="Profile photo visibility"
            description="Show your photo to everyone"
            checked={privacy.profilePhoto}
            onChange={toggle('profilePhoto', 'Profile photo')}
          />
        </Rows>
      </Section>

      <Section title="Groups">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-500">
            <UserPlus size={18} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium text-content">Who can add me to groups</p>
            <p className="text-xs text-content-muted">Choose who is allowed to add you to group chats.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { id: 'everyone', label: 'Everyone' },
                { id: 'contacts', label: 'Contacts' },
              ].map((opt) => (
                <Chip
                  key={opt.id}
                  active={addToGroups === opt.id}
                  onClick={() => {
                    setAddToGroups(opt.id);
                    toast.success(`Group invites: ${opt.label}`);
                  }}
                >
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </motion.div>
  );
}

/* ── Notifications ────────────────────────────────────────────── */
function NotificationsPanel() {
  const [prefs, setPrefs] = useState({
    messages: true,
    groups: true,
    calls: true,
    meetings: true,
    sounds: false,
  });

  const toggle = (key, label) => (next) => {
    setPrefs((p) => ({ ...p, [key]: next }));
    toast.success(`${label} ${next ? 'on' : 'off'}`);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section title="Notifications" description="Decide what pings you and how.">
        <Rows>
          <ToggleRow
            icon={MessageSquare}
            title="Message notifications"
            description="Alerts for new direct messages"
            checked={prefs.messages}
            onChange={toggle('messages', 'Message notifications')}
          />
          <ToggleRow
            icon={Users}
            title="Group notifications"
            description="Alerts for activity in your groups"
            checked={prefs.groups}
            onChange={toggle('groups', 'Group notifications')}
          />
          <ToggleRow
            icon={PhoneCall}
            title="Call notifications"
            description="Ring for incoming voice & video calls"
            checked={prefs.calls}
            onChange={toggle('calls', 'Call notifications')}
          />
          <ToggleRow
            icon={CalendarClock}
            title="Meeting reminders"
            description="Get notified before scheduled meetings"
            checked={prefs.meetings}
            onChange={toggle('meetings', 'Meeting reminders')}
          />
          <ToggleRow
            icon={Volume2}
            title="Sounds"
            description="Play a sound for new activity"
            checked={prefs.sounds}
            onChange={toggle('sounds', 'Sounds')}
          />
        </Rows>
      </Section>
    </motion.div>
  );
}

/* ── Appearance ───────────────────────────────────────────────── */
const THEME_CARDS = [
  { id: 'light', label: 'Light', icon: Sun, swatch: 'bg-white', dots: ['bg-slate-200', 'bg-slate-300'] },
  { id: 'dark', label: 'Dark', icon: Moon, swatch: 'bg-navy-900', dots: ['bg-navy-800', 'bg-slate-600'] },
  { id: 'system', label: 'System', icon: Monitor, swatch: 'bg-gradient-to-br from-white to-navy-900', dots: ['bg-slate-300', 'bg-navy-800'] },
];

function AppearancePanel() {
  const { theme, setTheme, accent, setAccent } = useUI();
  // 'system' is presentational only in demo — it maps to dark.
  const [selection, setSelection] = useState(theme === 'light' ? 'light' : 'dark');

  const pick = (id) => {
    setSelection(id);
    setTheme(id === 'system' ? 'dark' : id);
    toast.success(`${id === 'system' ? 'System' : id[0].toUpperCase() + id.slice(1)} theme applied`);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section title="Theme" description="Choose how ChatConnect looks to you.">
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_CARDS.map(({ id, label, icon: Icon, swatch, dots }) => {
            const active = selection === id;
            return (
              <motion.button
                key={id}
                type="button"
                onClick={() => pick(id)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={cn(
                  'ring-brand relative overflow-hidden rounded-2xl border p-3 text-left transition-colors',
                  active
                    ? 'border-brand-500/60 bg-brand-500/5 shadow-glow'
                    : 'border-border bg-surface-2/60 hover:border-brand-500/30'
                )}
              >
                {/* Preview swatch */}
                <div className={cn('mb-3 h-20 w-full overflow-hidden rounded-xl border border-border', swatch)}>
                  <div className="flex h-full flex-col justify-end gap-1.5 p-2.5">
                    <div className={cn('h-2 w-3/4 rounded-full', dots[0])} />
                    <div className={cn('h-2 w-1/2 rounded-full', dots[1])} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-content">
                    <Icon size={16} className={active ? 'text-brand-500' : 'text-content-muted'} />
                    {label}
                  </span>
                  <span
                    className={cn(
                      'grid h-5 w-5 place-items-center rounded-full transition-all',
                      active ? 'bg-brand-gradient text-white' : 'bg-content/10 text-transparent'
                    )}
                  >
                    <Check size={13} />
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </Section>

      <Section title="Accent color" description="Recolors buttons, highlights and gradients across the whole app.">
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {ACCENTS.map((a) => {
            const active = accent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setAccent(a.id);
                  toast.success(`${a.name} accent applied`);
                }}
                className="ring-brand flex flex-col items-center gap-1.5 rounded-xl p-1"
                aria-label={`Use ${a.name} accent`}
                aria-pressed={active}
              >
                <span
                  style={{ backgroundColor: a.dot }}
                  className={cn(
                    'grid h-10 w-10 place-items-center rounded-full text-white shadow-soft ring-2 ring-offset-2 ring-offset-surface transition-all',
                    active ? 'ring-content/40 scale-105' : 'ring-transparent hover:scale-105'
                  )}
                >
                  {active && <Check size={16} />}
                </span>
                <span className={cn('text-[11px] font-medium', active ? 'text-content' : 'text-content-muted')}>{a.name}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </motion.div>
  );
}

/* ── Workspace (organization) ─────────────────────────────────── */
function WorkspacePanel() {
  const { workspace, members, myRole, memberCount, load, rename, rotateInvite } = useWorkspace();
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const isManager = myRole === 'owner' || myRole === 'admin';

  useEffect(() => {
    if (!DEMO_MODE) load();
  }, [load]);
  useEffect(() => {
    if (workspace?.name) setName(workspace.name);
  }, [workspace?.name]);

  if (DEMO_MODE) {
    return (
      <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
        <Section title="Workspace" description="Your organization / team.">
          <p className="mt-2 text-sm text-content-muted">Workspaces need the live backend. Turn off demo mode to manage your organization.</p>
        </Section>
      </motion.div>
    );
  }

  if (!workspace) {
    return (
      <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
        <Section title="Workspace"><p className="mt-2 text-sm text-content-muted">Loading your workspace…</p></Section>
      </motion.div>
    );
  }

  const inviteLink = workspace.inviteLink;
  const copyLink = () => navigator.clipboard?.writeText(inviteLink).then(() => toast.success('Invite link copied'), () => toast.error('Copy failed'));
  const saveName = async () => {
    if (!name.trim() || name === workspace.name) return;
    setSavingName(true);
    try {
      await rename(name.trim());
      toast.success('Workspace renamed');
    } catch {
      toast.error('Could not rename workspace');
    } finally {
      setSavingName(false);
    }
  };
  const rotate = async () => {
    if (!window.confirm('Generate a new invite link? The current link will stop working.')) return;
    try {
      await rotateInvite();
      toast.success('New invite link generated');
    } catch {
      toast.error('Could not rotate the invite');
    }
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section title="Workspace" description="Everyone in your workspace can find, message and call each other. People outside it can't.">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brand-500">{workspace.plan} plan</span>
          <span className="text-xs text-content-muted">{memberCount} member{memberCount === 1 ? '' : 's'} · you're {myRole}</span>
        </div>
        {isManager ? (
          <div className="mt-4 flex items-end gap-2">
            <div className="flex-1"><Field label="Workspace name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <Button onClick={saveName} disabled={savingName || !name.trim() || name === workspace.name}>Save</Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-content">You're a member of <span className="font-semibold">{workspace.name}</span>.</p>
        )}
      </Section>

      {isManager && inviteLink && (
        <Section title="Invite teammates" description="Share this link — anyone who signs up with it joins your workspace.">
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-content">{inviteLink}</code>
            <Button size="sm" variant="subtle" onClick={copyLink}><Copy size={14} /> Copy</Button>
          </div>
          <button onClick={rotate} className="mt-2 text-xs font-medium text-content-muted hover:text-content">Generate a new link (revokes the current one)</button>
        </Section>
      )}

      <Section title="Members" description={`${memberCount} in ${workspace.name}`}>
        <div className="mt-2 space-y-2">
          {members.map((m) => (
            <div key={m._id} className="flex items-center gap-3 rounded-2xl border border-border p-2.5">
              <Avatar src={m.avatar} name={m.name} size="sm" online={m.isOnline} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content">{m.name}</p>
                <p className="truncate text-xs text-content-muted">@{m.username}</p>
              </div>
              <span className="rounded-full bg-content/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-content-muted">{m.workspaceRole}</span>
            </div>
          ))}
        </div>
      </Section>
    </motion.div>
  );
}

/* ── Developer / API keys ─────────────────────────────────────── */
const SCOPE_LABELS = {
  'chat:read': 'Read chats & messages',
  'chat:write': 'Send messages / open chats',
  'contacts:read': 'Read contacts & search users',
  'calls:write': 'Start calls',
  'meetings:read': 'Read meetings',
  'meetings:write': 'Schedule meetings',
};
const DEFAULT_SCOPES = ['chat:read', 'chat:write', 'contacts:read', 'calls:write', 'meetings:read', 'meetings:write'];

const API_V1_BASE =
  (import.meta.env.VITE_API_URL || 'https://chat-app-zqj9.onrender.com').replace(/\/+$/, '').replace(/\/api$/, '') +
  '/api/v1';

const API_ENDPOINTS = [
  ['GET', '/me', '—', 'The key owner + granted scopes'],
  ['GET', '/contacts', 'contacts:read', 'The owner’s contacts'],
  ['GET', '/users/search?q=', 'contacts:read', 'Find users by name/username/email'],
  ['GET', '/chats', 'chat:read', 'The owner’s conversations'],
  ['POST', '/chats/direct/:userId', 'chat:write', 'Get-or-create a 1:1 chat'],
  ['GET', '/messages/:chatId', 'chat:read', 'Messages in a chat'],
  ['POST', '/messages', 'chat:write', 'Send a message'],
  ['POST', '/calls', 'calls:write', 'Start a call'],
  ['GET', '/meetings', 'meetings:read', 'List meetings'],
  ['POST', '/meetings', 'meetings:write', 'Schedule a meeting'],
];

function DeveloperPanel() {
  const { keys, scopes, load, create, revoke } = useApiKeys();
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState(['chat:read', 'chat:write', 'contacts:read']);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // plaintext, shown once

  useEffect(() => {
    if (!DEMO_MODE) load();
  }, [load]);

  const available = scopes.length ? scopes : DEFAULT_SCOPES;
  const toggle = (s) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  const onCreate = async () => {
    if (picked.length === 0) return toast.error('Select at least one scope');
    setCreating(true);
    try {
      const secret = await create(label.trim() || 'API key', picked);
      setNewKey(secret);
      setLabel('');
      toast.success('API key created');
    } catch (err) {
      toast.error(err.message || 'Could not create key');
    } finally {
      setCreating(false);
    }
  };

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
  };

  if (DEMO_MODE) {
    return (
      <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
        <Section title="Developer / API keys" description="Integrate ChatConnect into another platform.">
          <p className="mt-2 text-sm text-content-muted">API keys require the live backend. Turn off demo mode to create keys.</p>
        </Section>
      </motion.div>
    );
  }

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section title="Developer / API keys" description="Create keys to use the ChatConnect API (v1) from another platform. A key acts as your account, limited to the scopes you grant.">
        {newKey && (
          <div className="mt-3 rounded-2xl border border-brand-500/40 bg-brand-500/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-content"><AlertTriangle size={15} className="text-amber-500" /> Copy this key now — it won't be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-content">{newKey}</code>
              <Button size="sm" variant="subtle" onClick={() => copy(newKey)}><Copy size={14} /> Copy</Button>
            </div>
            <button onClick={() => setNewKey(null)} className="mt-2 text-xs font-medium text-content-muted hover:text-content">Done</button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. My integration" /></Field>
          <div>
            <p className="mb-2 text-sm font-medium text-content">Scopes</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map((s) => (
                <button key={s} onClick={() => toggle(s)} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors', picked.includes(s) ? 'border-brand-500 bg-brand-500/10 text-content' : 'border-border text-content-muted hover:bg-content/5')}>
                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', picked.includes(s) ? 'border-brand-500 bg-brand-gradient text-white' : 'border-border')}>{picked.includes(s) && <Check size={11} />}</span>
                  <span className="min-w-0"><span className="block truncate font-medium">{SCOPE_LABELS[s] || s}</span><span className="block truncate text-[11px] opacity-70">{s}</span></span>
                </button>
              ))}
            </div>
          </div>
          <Button onClick={onCreate} disabled={creating}><Plus size={16} /> {creating ? 'Creating…' : 'Create API key'}</Button>
        </div>
      </Section>

      <Section title="Your keys" description={`${keys.length} active`}>
        {keys.length === 0 ? (
          <p className="mt-2 text-sm text-content-muted">No API keys yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-500"><KeyRound size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-content">{k.label}</p>
                  <p className="truncate text-xs text-content-muted"><code>{k.prefix}…</code> · {k.scopes.join(', ')}</p>
                  <p className="text-[11px] text-content-muted">{k.lastUsedAt ? `Last used ${formatRelative(k.lastUsedAt)}` : 'Never used'}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revoke(k.id).then(() => toast('Key revoked'))} className="shrink-0 text-red-500 hover:bg-red-500/10"><Trash2 size={15} /> Revoke</Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Using the API" description="Send your key as an X-API-Key header on every request — from your server, never from a browser.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface-2/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted"><Terminal size={13} /> Base URL</p>
            <code className="mt-1 block truncate text-xs font-medium text-content">{API_V1_BASE}</code>
          </div>
          <div className="rounded-2xl border border-border bg-surface-2/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted"><KeyRound size={13} /> Auth</p>
            <p className="mt-1 text-xs font-medium text-content"><code>X-API-Key</code> header</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface-2/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted"><AlertTriangle size={13} /> Rate limit</p>
            <p className="mt-1 text-xs font-medium text-content">120 req / min per key</p>
          </div>
        </div>

        <p className="mb-1.5 mt-4 text-sm font-medium text-content">Quickstart {newKey ? '(using your new key)' : ''}</p>
        <div className="flex items-start gap-2">
          <pre className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-2xl bg-navy-950 p-4 text-xs leading-relaxed text-cyan-100">{`curl ${API_V1_BASE}/me \\\n  -H "X-API-Key: ${newKey || 'cc_live_…'}"`}</pre>
          <Button size="sm" variant="subtle" onClick={() => copy(`curl ${API_V1_BASE}/me -H "X-API-Key: ${newKey || 'cc_live_…'}"`)} className="shrink-0"><Copy size={14} /></Button>
        </div>

        <p className="mb-1.5 mt-4 text-sm font-medium text-content">Endpoints</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-content-muted">
                <th className="pb-2 pr-3 font-semibold">Method</th>
                <th className="pb-2 pr-3 font-semibold">Path</th>
                <th className="pb-2 pr-3 font-semibold">Scope</th>
                <th className="pb-2 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {API_ENDPOINTS.map(([m, path, scope, purpose]) => (
                <tr key={path} className="border-t border-border">
                  <td className="py-2 pr-3"><span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-bold', m === 'GET' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-brand-500/15 text-brand-500')}>{m}</span></td>
                  <td className="py-2 pr-3"><code className="text-xs text-content">{path}</code></td>
                  <td className="py-2 pr-3 text-xs text-content-muted">{scope}</td>
                  <td className="py-2 text-xs text-content-muted">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Link to="/developers" className="ring-brand mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-500 hover:underline">
          <ExternalLink size={13} /> Open the full developer console
        </Link>
      </Section>
    </motion.div>
  );
}

/* ── Account ──────────────────────────────────────────────────── */
function AccountPanel() {
  const { logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setField = (key) => (e) => setPw((p) => ({ ...p, [key]: e.target.value }));

  const changePassword = (e) => {
    e.preventDefault();
    if (!pw.current || !pw.next || !pw.confirm) return toast.error('Please fill in all password fields');
    if (pw.next.length < 8) return toast.error('New password must be at least 8 characters');
    if (pw.next !== pw.confirm) return toast.error('New passwords do not match');
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password updated successfully');
    }, 900);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
      <Section title="Change password" description="Use at least 8 characters with a mix of letters and numbers.">
        <form onSubmit={changePassword} className="mt-2 space-y-4">
          <Field label="Current password">
            <Input icon={Lock} type="password" autoComplete="current-password" placeholder="••••••••" value={pw.current} onChange={setField('current')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password">
              <Input icon={Lock} type="password" autoComplete="new-password" placeholder="••••••••" value={pw.next} onChange={setField('next')} />
            </Field>
            <Field label="Confirm new password">
              <Input icon={Lock} type="password" autoComplete="new-password" placeholder="••••••••" value={pw.confirm} onChange={setField('confirm')} />
            </Field>
          </div>
          <Button type="submit" variant="primary" size="md" disabled={saving}>
            {saving ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Section>

      <Section title="Your data" description="Download a copy of your ChatConnect data.">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-500">
              <Download size={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-content">Export my data</p>
              <p className="text-xs text-content-muted">Messages, contacts and account info as an archive.</p>
            </div>
          </div>
          <Button variant="outline" size="md" onClick={() => toast.success('Preparing your data export…')} className="shrink-0">
            <Download size={16} /> Export
          </Button>
        </div>
      </Section>

      {/* Log out */}
      <Section>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-content/10 text-content">
              <LogOut size={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-content">Log out</p>
              <p className="text-xs text-content-muted">Sign out of this device.</p>
            </div>
          </div>
          <Button
            variant="glass"
            size="md"
            onClick={() => {
              logout();
              toast('Signed out', { icon: '👋' });
            }}
            className="shrink-0"
          >
            Log out
          </Button>
        </div>
      </Section>

      {/* Danger zone */}
      <motion.div
        variants={rise}
        className="rounded-3xl border border-red-500/30 bg-red-500/[0.04] p-5 shadow-soft sm:p-6"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-500/10 text-red-500">
            <AlertTriangle size={18} />
          </span>
          <div>
            <h3 className="font-display text-base font-bold text-red-500">Danger zone</h3>
            <p className="text-sm text-content-muted">Permanently delete your account and all of its data.</p>
          </div>
        </div>

        <div className="mt-4">
          <AnimatePresence mode="wait" initial={false}>
            {!confirmDelete ? (
              <motion.div
                key="delete-cta"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Button variant="danger" size="md" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} /> Delete account
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="delete-confirm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-red-500/30 bg-surface-2/70 p-4"
              >
                <p className="text-sm font-medium text-content">
                  Are you absolutely sure? This action cannot be undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setConfirmDelete(false);
                      toast.error('Account deletion requested');
                    }}
                  >
                    <Trash2 size={15} /> Yes, delete my account
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const [active, setActive] = useState('profile');
  const { user } = useAuth();
  const me = user || ME;

  // The Developer / API-keys tab is only for platform admins (the developer
  // running the deployment). Regular workspace members just use the chat app —
  // API keys grant programmatic access to chats, messages & contacts.
  const isPlatformAdmin = me?.role === 'admin';
  const tabs = TABS.filter((t) => t.id !== 'developer' || isPlatformAdmin);

  const renderPanel = () => {
    switch (active) {
      case 'profile':
        return <ProfilePanel user={me} />;
      case 'privacy':
        return <PrivacyPanel />;
      case 'notifications':
        return <NotificationsPanel />;
      case 'appearance':
        return <AppearancePanel />;
      case 'workspace':
        return <WorkspacePanel />;
      case 'developer':
        return isPlatformAdmin ? <DeveloperPanel /> : null;
      case 'account':
        return <AccountPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <motion.div
        variants={stagger}
        initial="initial"
        animate="animate"
        className="mx-auto max-w-5xl p-4 md:p-6"
      >
        {/* Header */}
        <motion.div variants={rise} className="mb-6">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-content sm:text-3xl">
            <span className="gradient-text">Settings</span>
          </h1>
          <p className="mt-1 text-sm text-content-muted">Manage your profile, privacy and preferences.</p>
        </motion.div>

        {/* Mobile: horizontal scrollable chip row */}
        <motion.div variants={rise} className="mb-5 -mx-4 px-4 md:hidden">
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <Chip
                key={id}
                active={active === id}
                onClick={() => setActive(id)}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
              >
                <Icon size={14} /> {label}
              </Chip>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
          {/* Desktop: vertical tab list */}
          <motion.nav variants={rise} className="hidden md:block">
            <div className="glass sticky top-6 rounded-3xl p-2 shadow-soft">
              {tabs.map(({ id, label, icon: Icon }) => {
                const isActive = active === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActive(id)}
                    className={cn(
                      'ring-brand relative flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm font-semibold transition-colors',
                      isActive ? 'text-white' : 'text-content-muted hover:bg-content/5 hover:text-content'
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="settings-tab-active"
                        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                        className="absolute inset-0 rounded-2xl bg-brand-gradient shadow-glow"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-3">
                      <Icon size={18} />
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.nav>

          {/* Right content panel */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div key={active} {...panelMotion}>
                {renderPanel()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
