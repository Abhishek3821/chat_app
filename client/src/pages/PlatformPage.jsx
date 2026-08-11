import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Blocks,
  Plus,
  Copy,
  RefreshCw,
  Power,
  Users,
  KeyRound,
  ShieldAlert,
  ChevronDown,
  Check,
} from 'lucide-react';
import Button from '../components/ui/Button';
import { Input, Field } from '../components/ui/Input';
import Switch from '../components/ui/Switch';
import EmptyState from '../components/ui/EmptyState';
import { useApps } from '../store/useApps';
import { cn } from '../lib/utils';

/**
 * The embeddable-platform console: one screen showing every capability a tenant
 * ("App") can be granted, and letting an admin turn each on or off.
 *
 * Mirrors APP_FEATURES in server/models/App.js. The flags here are only the
 * CONTROL surface — the server refuses a disabled capability at the API
 * (requireFeature), so a tampered embed gains nothing by ignoring them.
 */
const FEATURES = [
  { id: 'chat', label: 'Direct messaging', hint: '1:1 conversations' },
  { id: 'groups', label: 'Group chats', hint: 'Multi-party rooms' },
  { id: 'calls', label: 'Voice calls', hint: '1:1 audio' },
  { id: 'video', label: 'Video calls', hint: 'Camera calls' },
  { id: 'meetings', label: 'Meetings', hint: 'Scheduled + instant rooms' },
  { id: 'status', label: 'Status / stories', hint: 'Ephemeral posts' },
  { id: 'presence', label: 'Presence', hint: 'Online + last seen' },
  { id: 'typing', label: 'Typing indicators', hint: '“…is typing”' },
  { id: 'receipts', label: 'Read receipts', hint: 'Delivered + read ticks' },
  { id: 'reactions', label: 'Reactions', hint: 'Emoji on messages' },
  { id: 'attachments', label: 'Attachments', hint: 'Images, files, media' },
  { id: 'voiceNotes', label: 'Voice notes', hint: 'Recorded audio messages' },
  { id: 'push', label: 'Web push', hint: 'Notify closed clients' },
];

const copy = (text, what) =>
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(`${what} copied`), () => toast.error('Copy failed'));

export default function PlatformPage() {
  const { apps, loading, stats, revealedSecrets, load, create, update, toggleFeature, rotate, disable, loadStats, dismissSecret } =
    useApps();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null); // expanded app id

  useEffect(() => { load().catch(() => toast.error('Could not load your apps.')); }, [load]);

  const onCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Give the app a name.');
    setCreating(true);
    try {
      const res = await create({ name: name.trim() });
      setName('');
      setOpen(res.app._id);
      toast.success('App created — copy the secret now, it is shown once.');
    } catch (err) {
      toast.error(err?.message || 'Could not create the app.');
    } finally {
      setCreating(false);
    }
  };

  const expand = async (id) => {
    setOpen((cur) => (cur === id ? null : id));
    if (!stats[id]) loadStats(id).catch(() => {});
  };

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 md:p-6 xl:max-w-5xl">
        <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 sm:items-center">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <Blocks size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              <span className="gradient-text">Embed platform</span>
            </h1>
            <p className="text-sm text-content-muted">
              Drop chat, calls and meetings into another product. Each app gets isolated users and its own capabilities.
            </p>
          </div>
        </motion.header>

        {/* Create */}
        <form onSubmit={onCreate} className="card mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="New app name">
              <Input placeholder="e.g. Acme CRM" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={creating} className="shrink-0">
            <Plus size={16} /> {creating ? 'Creating…' : 'Create app'}
          </Button>
        </form>

        {loading && <p className="mt-6 text-sm text-content-muted">Loading…</p>}

        {!loading && apps.length === 0 && (
          <div className="mt-6">
            <EmptyState
              icon={Blocks}
              title="No embedded apps yet"
              description="Create one to get an app id and secret, then provision your product's users and mint tokens for them."
            />
          </div>
        )}

        <div className="mt-6 space-y-3">
          {apps.map((app) => {
            const isOpen = open === app._id;
            const secret = revealedSecrets[app._id];
            const s = stats[app._id];
            return (
              <div key={app._id} className="card overflow-hidden">
                {/* Summary row */}
                <button onClick={() => expand(app._id)} className="flex w-full items-center gap-3 p-4 text-left">
                  <span className={cn('neu-inset grid h-10 w-10 shrink-0 place-items-center rounded-xl', app.active ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted')}>
                    <Blocks size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-content">{app.name}</span>
                      {!app.active && (
                        <span className="neu-inset-sm shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase text-content-muted">
                          disabled
                        </span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-xs text-content-muted">{app.appId}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 text-xs text-content-muted sm:flex">
                    <Users size={13} /> {app.usage?.users ?? 0}
                  </span>
                  <ChevronDown size={18} className={cn('shrink-0 text-content-muted transition-transform', isOpen && 'rotate-180')} />
                </button>

                {isOpen && (
                  <div className="border-t border-border p-4">
                    {/* The secret is shown exactly once — make that unmissable. */}
                    {secret && (
                      <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          <ShieldAlert size={14} /> Copy this secret now — it is never shown again
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="neu-inset min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs">{secret}</code>
                          <Button variant="glass" size="icon-sm" onClick={() => copy(secret, 'Secret')} aria-label="Copy secret">
                            <Copy size={15} />
                          </Button>
                        </div>
                        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                          Server-side only. It can provision users and mint tokens for anyone in this app — never ship it to a browser.
                        </p>
                        <button onClick={() => dismissSecret(app._id)} className="mt-2 text-[11px] font-semibold text-content-muted hover:text-content">
                          I've stored it — hide
                        </button>
                      </div>
                    )}

                    {/* Credentials + stats */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="neu-inset rounded-2xl bg-surface-2 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">App ID (public)</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate font-mono text-xs text-content">{app.appId}</code>
                          <button onClick={() => copy(app.appId, 'App ID')} className="shrink-0 text-content-muted hover:text-content" aria-label="Copy app id">
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="neu-inset rounded-2xl bg-surface-2 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Secret</p>
                        <p className="mt-1 font-mono text-xs text-content">{app.secretPrefix}••••••••</p>
                      </div>
                    </div>

                    {s && (
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          ['Users', s.users],
                          ['Active', s.activeUsers],
                          ['Tokens issued', s.tokensIssued],
                          ['Seat limit', s.seatLimit],
                        ].map(([label, value]) => (
                          <div key={label} className="neu-raised-sm rounded-2xl bg-surface p-3 text-center">
                            <p className="text-lg font-bold tabular-nums text-content">{value ?? 0}</p>
                            <p className="text-[11px] text-content-muted">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Capabilities — the whole point of the screen */}
                    <p className="mt-5 text-xs font-bold uppercase tracking-wide text-content-muted">Capabilities</p>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {FEATURES.map((f) => {
                        const on = (app.features || []).includes(f.id);
                        return (
                          <label key={f.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-content/5">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-content">{f.label}</span>
                              <span className="block truncate text-[11px] text-content-muted">{f.hint}</span>
                            </span>
                            <Switch
                              checked={on}
                              onChange={() =>
                                toggleFeature(app._id, f.id).catch((e) => toast.error(e?.message || 'Could not save that.'))
                              }
                            />
                          </label>
                        );
                      })}
                    </div>

                    {/* Limits */}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Field label="Seat limit">
                        <Input
                          type="number"
                          defaultValue={app.limits?.maxUsers ?? 10000}
                          onBlur={(e) => update(app._id, { limits: { maxUsers: Number(e.target.value) } }).catch(() => toast.error('Could not save the seat limit.'))}
                        />
                      </Field>
                      <Field label="User-token lifetime (minutes)">
                        <Input
                          type="number"
                          defaultValue={app.limits?.userTokenMinutes ?? 60}
                          onBlur={(e) => update(app._id, { limits: { userTokenMinutes: Number(e.target.value) } }).catch(() => toast.error('Could not save the token lifetime.'))}
                        />
                      </Field>
                    </div>

                    {/* Integration snippet */}
                    <p className="mt-5 text-xs font-bold uppercase tracking-wide text-content-muted">Integrate</p>
                    <pre className="scrollbar-thin mt-2 overflow-x-auto rounded-2xl bg-navy-950 p-4 text-[11px] leading-relaxed text-cyan-100">
{`# 1) YOUR BACKEND — provision the user (idempotent)
curl -X POST ${window.location.origin.replace(/:\d+$/, ':5000')}/api/v1/platform/users \\
  -H "X-CC-App-Id: ${app.appId}" \\
  -H "Authorization: Bearer <APP_SECRET>" \\
  -H "Content-Type: application/json" \\
  -d '{"externalId":"your-user-42","name":"Ada Lovelace"}'

# 2) YOUR BACKEND — mint a short-lived token for them
curl -X POST ${window.location.origin.replace(/:\d+$/, ':5000')}/api/v1/platform/tokens \\
  -H "X-CC-App-Id: ${app.appId}" \\
  -H "Authorization: Bearer <APP_SECRET>" \\
  -H "Content-Type: application/json" \\
  -d '{"externalId":"your-user-42"}'

# 3) YOUR FRONTEND — hand that token to the embed (never the secret)`}
                    </pre>

                    {/* Danger zone */}
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          rotate(app._id)
                            .then(() => toast.success('Secret rotated — the old one no longer works.'))
                            .catch((e) => toast.error(e?.message || 'Could not rotate.'))
                        }
                      >
                        <RefreshCw size={15} /> Rotate secret
                      </Button>
                      {app.active ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (!window.confirm(`Disable “${app.name}”? Its users lose access immediately.`)) return;
                            disable(app._id)
                              .then(() => toast.success('App disabled.'))
                              .catch((e) => toast.error(e?.message || 'Could not disable.'));
                          }}
                        >
                          <Power size={15} /> Disable app
                        </Button>
                      ) : (
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() =>
                            update(app._id, { active: true })
                              .then(() => toast.success('App re-enabled.'))
                              .catch((e) => toast.error(e?.message || 'Could not enable.'))
                          }
                        >
                          <Check size={15} /> Re-enable
                        </Button>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-content-muted">
                        <KeyRound size={12} />
                        {app.secretRotatedAt ? `rotated ${new Date(app.secretRotatedAt).toLocaleDateString()}` : 'never rotated'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
