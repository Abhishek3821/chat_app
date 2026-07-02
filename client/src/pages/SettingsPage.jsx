import { useState } from 'react';
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
} from 'lucide-react';

import Switch, { ToggleRow } from '@/components/ui/Switch';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { useAuth } from '@/store/useAuth';
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

const ACCENTS = [
  { name: 'Indigo', className: 'bg-brand-500' },
  { name: 'Violet', className: 'bg-violet-500' },
  { name: 'Cyan', className: 'bg-cyan-500' },
  { name: 'Gradient', className: 'bg-brand-gradient' },
];

function AppearancePanel() {
  const { theme, setTheme } = useUI();
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

      <Section title="Accent color" description="A preview of the palette used across the app.">
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {ACCENTS.map((a, i) => (
            <div key={a.name} className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'h-10 w-10 rounded-full shadow-soft ring-2 ring-offset-2 ring-offset-surface',
                  a.className,
                  i === 0 ? 'ring-brand-500/60' : 'ring-transparent'
                )}
              />
              <span className="text-[11px] font-medium text-content-muted">{a.name}</span>
            </div>
          ))}
        </div>
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
            {TABS.map(({ id, label, icon: Icon }) => (
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
              {TABS.map(({ id, label, icon: Icon }) => {
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
