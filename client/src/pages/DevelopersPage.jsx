import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  KeyRound,
  Copy,
  Plus,
  Trash2,
  Check,
  Terminal,
  Zap,
  ShieldCheck,
  AlertTriangle,
  BookOpen,
  Code2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { useApiKeys } from '@/store/useApiKeys';
import { DEMO_MODE } from '@/lib/api';
import { formatRelative, cn } from '@/lib/utils';

const API_BASE = (import.meta.env.VITE_API_URL || 'https://chat-app-zqj9.onrender.com').replace(/\/+$/, '') + '/api/v1';

const SCOPE_LABELS = {
  'chat:read': 'Read chats & messages',
  'chat:write': 'Send messages / open chats',
  'contacts:read': 'Read contacts & search users',
  'calls:write': 'Start calls',
  'meetings:read': 'Read meetings',
  'meetings:write': 'Schedule meetings',
};
const DEFAULT_SCOPES = Object.keys(SCOPE_LABELS);

const ENDPOINTS = [
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

const rise = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};
const stagger = { animate: { transition: { staggerChildren: 0.05 } } };

function Card({ children, className }) {
  return (
    <motion.div variants={rise} className={cn('glass rounded-3xl p-5 shadow-soft sm:p-6', className)}>
      {children}
    </motion.div>
  );
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.error('Copy failed')
  );
}

export default function DevelopersPage() {
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

  const curl = useMemo(
    () =>
      `curl ${API_BASE}/me \\\n  -H "X-API-Key: ${newKey || 'cc_live_…'}"`,
    [newKey]
  );

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      {/* Header */}
      <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
          <Code2 className="text-white" size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-content">Developers</h1>
          <p className="text-xs text-content-muted">Build chat, calls & meetings into your own product with the ChatConnect API.</p>
        </div>
      </motion.header>

      <motion.div variants={stagger} initial="initial" animate="animate" className="mt-5 space-y-5">
        {/* At-a-glance */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="!p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted"><Terminal size={14} /> Base URL</p>
            <code className="mt-1 block truncate text-sm font-medium text-content">{API_BASE}</code>
          </Card>
          <Card className="!p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted"><Zap size={14} /> Rate limit</p>
            <p className="mt-1 text-sm font-medium text-content">120 requests / min per key</p>
          </Card>
          <Card className="!p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted"><ShieldCheck size={14} /> Auth</p>
            <p className="mt-1 text-sm font-medium text-content"><code>X-API-Key</code> header</p>
          </Card>
        </div>

        {DEMO_MODE && (
          <Card>
            <p className="flex items-center gap-2 text-sm font-medium text-content"><AlertTriangle size={16} className="text-amber-500" /> You’re in demo mode</p>
            <p className="mt-1 text-sm text-content-muted">API keys need the live backend. The reference below is still accurate — deploy or run against the API to create real keys.</p>
          </Card>
        )}

        {/* Create key */}
        {!DEMO_MODE && (
          <Card>
            <h2 className="text-lg font-bold text-content">Create an API key</h2>
            <p className="mt-0.5 text-sm text-content-muted">A key acts as your account, limited to the scopes you grant it. The secret is shown once.</p>

            {newKey && (
              <div className="mt-4 rounded-2xl border border-brand-500/40 bg-brand-500/5 p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-content"><AlertTriangle size={15} className="text-amber-500" /> Copy this key now — it won’t be shown again.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-content">{newKey}</code>
                  <Button size="sm" variant="subtle" onClick={() => copy(newKey)}><Copy size={14} /> Copy</Button>
                </div>
                <button onClick={() => setNewKey(null)} className="mt-2 text-xs font-medium text-content-muted hover:text-content">Done</button>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme production" /></Field>
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
          </Card>
        )}

        {/* Your keys */}
        {!DEMO_MODE && (
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-content">Your keys</h2>
              <span className="text-xs text-content-muted">{keys.length} active</span>
            </div>
            {keys.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">No API keys yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
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
          </Card>
        )}

        {/* Quickstart */}
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-bold text-content"><Terminal size={18} /> Quickstart</h2>
          <p className="mt-0.5 text-sm text-content-muted">Send your key on every request from your server (never from a browser).</p>
          <div className="mt-3 flex items-start gap-2">
            <pre className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-2xl bg-navy-950 p-4 text-xs leading-relaxed text-cyan-100">{curl}</pre>
            <Button size="sm" variant="subtle" onClick={() => copy(curl)} className="shrink-0"><Copy size={14} /></Button>
          </div>
        </Card>

        {/* Endpoints */}
        <Card>
          <h2 className="text-lg font-bold text-content">Endpoints</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-content-muted">
                  <th className="pb-2 pr-3 font-semibold">Method</th>
                  <th className="pb-2 pr-3 font-semibold">Path</th>
                  <th className="pb-2 pr-3 font-semibold">Scope</th>
                  <th className="pb-2 font-semibold">Purpose</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {ENDPOINTS.map(([m, path, scope, purpose]) => (
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
          <p className="mt-3 flex items-center gap-1.5 text-xs text-content-muted"><BookOpen size={13} /> Full reference &amp; examples in <code>docs/API_V1.md</code>.</p>
        </Card>
      </motion.div>
    </div>
  );
}
