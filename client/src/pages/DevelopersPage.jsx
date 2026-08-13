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
  ChevronDown,
  Lock,
} from 'lucide-react';
import { Webhook } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { useApiKeys } from '@/store/useApiKeys';
import api, { DEMO_MODE } from '@/lib/api';
import { formatRelative, cn, PAGE_SHELL } from '@/lib/utils';

const ORIGIN = (import.meta.env.VITE_API_URL || 'https://chat-app-zqj9.onrender.com').replace(/\/api\/?$/, '').replace(/\/+$/, '');

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

/**
 * Per-key integration guide, generated FROM THAT KEY'S SCOPES.
 *
 * Deliberately scope-aware rather than one generic snippet: showing
 * `POST /messages` to someone holding a read-only key sends them to debug a 403
 * that is working exactly as configured. Everything the key cannot do is listed
 * separately, with the scope it would need, so a missing endpoint is explained
 * instead of just absent.
 *
 * `plaintext` is only present for a key created in this page view — the server
 * stores a hash, so for every other key the snippets use a placeholder.
 */
function KeyIntegration({ k, plaintext }) {
  const KEY = plaintext || '<YOUR_API_KEY>';
  const has = (s) => k.scopes.includes(s);
  const allowed = ENDPOINTS.filter(([, , scope]) => scope === '—' || has(scope));
  const missing = ENDPOINTS.filter(([, , scope]) => scope !== '—' && !has(scope));

  const step1 = `curl ${API_BASE}/me \\\n  -H "X-API-Key: ${KEY}"`;

  // A reusable helper is the shape almost everyone actually wants, and it puts
  // the key in an env var — which is the habit worth teaching.
  const step2 = `// Node 18+ · keep this on your SERVER. Never ship a key to a browser.
const CC_KEY = process.env.CHATKONECT_API_KEY; // ${k.prefix}…

async function cc(path, init = {}) {
  const res = await fetch('${API_BASE}' + path, {
    ...init,
    headers: { 'X-API-Key': CC_KEY, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error('ChatKonect ' + res.status + ': ' + (await res.text()));
  return res.json();
}`;

  /* A first task built from what this key can actually do. Ordered by how
     commonly each one is the reason a key gets created at all. */
  let step3 = null;
  if (has('chat:write')) {
    step3 = {
      title: has('contacts:read') ? 'Send a message to a contact' : 'Send a message to a chat',
      code: has('contacts:read')
        ? `// 1. who can I message?
const { contacts } = await cc('/contacts');
const to = contacts[0];

// 2. get-or-create the 1:1 chat (safe to call repeatedly)
const { chat } = await cc('/chats/direct/' + to._id, { method: 'POST' });

// 3. send
await cc('/messages', {
  method: 'POST',
  body: JSON.stringify({ chatId: chat._id, content: 'Deploy finished ✅' }),
});`
        : `// You have chat:write but not contacts:read, so pass a chatId you
// already know (grant contacts:read to look people up from code).
await cc('/messages', {
  method: 'POST',
  body: JSON.stringify({ chatId: '<CHAT_ID>', content: 'Deploy finished ✅' }),
});`,
    };
  } else if (has('meetings:write')) {
    step3 = {
      title: 'Schedule a meeting',
      code: `const { meeting } = await cc('/meetings', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Kickoff',
    startAt: new Date(Date.now() + 3600_000).toISOString(),
    durationMinutes: 30,
    type: 'video',
  }),
});
console.log('Share this link:', meeting.link);`,
    };
  } else if (has('calls:write')) {
    step3 = {
      title: 'Start a call',
      code: `await cc('/calls', {
  method: 'POST',
  body: JSON.stringify({ receiverId: '<USER_ID>', type: 'video' }),
});`,
    };
  } else if (has('chat:read')) {
    step3 = {
      title: 'Read your conversations',
      code: `const { chats } = await cc('/chats');
const { messages } = await cc('/messages/' + chats[0]._id + '?limit=20');
console.log(messages.map((m) => m.content));`,
    };
  }

  return (
    <div className="mt-3 border-t border-border pt-4">
      {/* Step 1 — the credential itself */}
      <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">1 · Authenticate</p>
      <p className="mt-1 text-xs text-content-muted">
        Every request carries <code className="neu-inset-sm rounded bg-surface-2 px-1">X-API-Key</code>. Base URL{' '}
        <code className="neu-inset-sm rounded bg-surface-2 px-1">{API_BASE}</code>. Limit: <strong>120 requests/minute</strong> per key.
      </p>
      {!plaintext && (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          The key itself is only shown at creation, so the snippets below use a placeholder — paste your own in.
        </p>
      )}
      <CodeBlock code={step1} />

      {/* Step 2 — the helper */}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-content-muted">2 · A tiny client</p>
      <CodeBlock code={step2} />

      {/* Step 3 — something real */}
      {step3 && (
        <>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-content-muted">3 · {step3.title}</p>
          <CodeBlock code={step3.code} />
        </>
      )}

      {/* What this key can and cannot reach */}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-content-muted">
        This key can call {allowed.length} endpoint{allowed.length === 1 ? '' : 's'}
      </p>
      <div className="mt-2 space-y-1">
        {allowed.map(([method, path, , desc]) => (
          <div key={method + path} className="flex items-center gap-2 text-xs">
            <span className="neu-raised-sm w-12 shrink-0 rounded bg-surface px-1 py-0.5 text-center font-mono text-[10px] font-bold text-brand-600 dark:text-brand-300">
              {method}
            </span>
            <code className="shrink-0 text-content">{path}</code>
            <span className="truncate text-content-muted">{desc}</span>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-content-muted">
            <Lock size={11} /> Not granted — would return 403
          </p>
          <div className="mt-2 space-y-1">
            {missing.map(([method, path, scope]) => (
              <div key={method + path} className="flex items-center gap-2 text-xs opacity-60">
                <span className="w-12 shrink-0 rounded bg-content/10 px-1 py-0.5 text-center font-mono text-[10px] font-bold text-content-muted">
                  {method}
                </span>
                <code className="shrink-0 text-content-muted">{path}</code>
                <span className="truncate text-content-muted">
                  needs <code>{scope}</code>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-content-muted">
            Scopes are fixed once a key is made — create a new key to change them.
          </p>
        </>
      )}
    </div>
  );
}

/** Code block with a copy button, used throughout the integration guide. */
function CodeBlock({ code }) {
  return (
    <div className="mt-2 flex items-start gap-2">
      <pre className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-2xl bg-navy-950 p-3.5 text-[11px] leading-relaxed text-cyan-100">
        {code}
      </pre>
      <Button size="sm" variant="subtle" onClick={() => copy(code)} className="h-9 w-9 shrink-0 px-0" aria-label="Copy snippet">
        <Copy size={14} />
      </Button>
    </div>
  );
}

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

/** Incoming webhooks — post into a group chat from an external service. */
function WebhooksCard() {
  const [hooks, setHooks] = useState([]);
  const [groups, setGroups] = useState([]);
  const [chatId, setChatId] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null); // { url } shown once, full URL

  const load = async () => {
    try {
      const [{ data: w }, { data: c }] = await Promise.all([api.get('/webhooks'), api.get('/chats')]);
      setHooks(w.webhooks || []);
      setGroups((c.chats || []).filter((x) => x.isGroup));
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!chatId) return toast.error('Pick a group to post into');
    setBusy(true);
    try {
      const { data } = await api.post('/webhooks', { chatId, label: label.trim() || 'Webhook' });
      setFresh({ url: `${ORIGIN}${data.webhook.url}` });
      setLabel('');
      await load();
      toast.success('Webhook created');
    } catch (err) {
      toast.error(err?.message || 'Could not create webhook');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    try { await api.delete(`/webhooks/${id}`); setHooks((h) => h.filter((x) => x.id !== id)); toast('Webhook revoked'); }
    catch { toast.error('Could not revoke'); }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-bold text-content"><Webhook size={18} /> Incoming webhooks</h2>
      <p className="mt-0.5 text-sm text-content-muted">Give an external service a secret URL to post messages into one of your groups (CI alerts, forms, monitoring). No login needed — the URL is the key.</p>

      {fresh && (
        <div className="mt-4 rounded-2xl border border-brand-500/40 bg-brand-500/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-content"><AlertTriangle size={15} className="text-amber-500" /> Copy this URL now — treat it like a password.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-content">{fresh.url}</code>
            <Button size="sm" variant="subtle" onClick={() => copy(fresh.url)} className="h-11 shrink-0 sm:h-9"><Copy size={14} /> Copy</Button>
          </div>
          <pre className="scrollbar-thin mt-2 overflow-x-auto rounded-xl bg-navy-950 p-3 text-[11px] leading-relaxed text-cyan-100">{`curl -X POST ${fresh.url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"text":"Deploy finished ✅"}'`}</pre>
          <button onClick={() => setFresh(null)} className="mt-2 text-xs font-medium text-content-muted hover:text-content">Done</button>
        </div>
      )}

      {/* minmax(0,1fr), not 1fr: a long group name in the <select> would otherwise
          widen its track past the card (auto is a 1fr track's default minimum). */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Group">
          <select value={chatId} onChange={(e) => setChatId(e.target.value)} className="ring-brand h-11 w-full rounded-xl neu-inset bg-surface-2 px-3 text-base text-content sm:text-sm">
            <option value="">Choose a group…</option>
            {groups.map((g) => <option key={g._id} value={g._id}>{g.name || 'Group'}</option>)}
          </select>
        </Field>
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. CI bot" /></Field>
        <Button onClick={create} disabled={busy || !chatId}><Plus size={16} /> {busy ? 'Creating…' : 'Create'}</Button>
      </div>

      {groups.length === 0 && <p className="mt-3 text-xs text-content-muted">Create or join a group first — webhooks post into group chats.</p>}

      {hooks.length > 0 && (
        <div className="mt-4 space-y-2">
          {hooks.map((h) => (
            <div key={h.id} className="neu-raised-sm flex items-center gap-3 rounded-2xl bg-surface p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl neu-inset bg-brand-500/10 text-brand-600 dark:text-brand-300"><Webhook size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content">{h.label} <span className="text-content-muted">→ {h.chatName}</span></p>
                <p className="truncate text-xs text-content-muted"><code>{ORIGIN}{h.url}</code></p>
                <p className="text-[11px] text-content-muted">{h.lastUsedAt ? `Last used ${formatRelative(h.lastUsedAt)}` : 'Never used'}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copy(`${ORIGIN}${h.url}`)} className="h-11 w-11 shrink-0 px-0 sm:h-9 sm:w-9"><Copy size={14} /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(h.id)} className="h-11 w-11 shrink-0 px-0 text-red-600 hover:bg-red-500/10 dark:text-red-400 sm:h-9 sm:w-9"><Trash2 size={15} /></Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function DevelopersPage() {
  const { keys, scopes, load, create, revoke } = useApiKeys();
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState(['chat:read', 'chat:write', 'contacts:read']);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // plaintext, shown once
  const [openKey, setOpenKey] = useState(null); // which key's integration guide is expanded

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
      /* Open the new key's guide straight away. This is the ONLY moment the
         plaintext exists, so it's the only time the snippets can carry the real
         key — asking the user to go and expand it themselves risks them copying
         the secret, dismissing the panel, and losing it. */
      const created = useApiKeys.getState().keys.find((k) => secret.startsWith(k.prefix));
      if (created) setOpenKey(created.id);
      toast.success('API key created — integration steps are open below.');
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
    <div className={PAGE_SHELL}>
      {/* Header */}
      <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
          <Code2 className="text-white" size={22} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-content">Developers</h1>
          <p className="text-xs text-content-muted">Build chat, calls & meetings into your own product with the ChatKonect API.</p>
        </div>
      </motion.header>

      <motion.div variants={stagger} initial="initial" animate="animate" className="mt-5 space-y-5">
        {/* At-a-glance */}
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-3">
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
                  <Button size="sm" variant="subtle" onClick={() => copy(newKey)} className="h-11 shrink-0 sm:h-9"><Copy size={14} /> Copy</Button>
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
                {keys.map((k) => {
                  const open = openKey === k.id;
                  // The plaintext belongs to this key only if it's the one just
                  // created — match on prefix so a second key can't show the first
                  // key's secret in its snippets.
                  const mine = newKey && newKey.startsWith(k.prefix) ? newKey : null;
                  return (
                    <div key={k.id} className="neu-raised-sm rounded-2xl bg-surface p-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl neu-inset bg-brand-500/10 text-brand-600 dark:text-brand-300"><KeyRound size={18} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-content">{k.label}</p>
                          <p className="truncate text-xs text-content-muted"><code>{k.prefix}…</code> · {k.scopes.join(', ')}</p>
                          <p className="text-[11px] text-content-muted">{k.lastUsedAt ? `Last used ${formatRelative(k.lastUsedAt)}` : 'Never used'}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => setOpenKey(open ? null : k.id)}
                          aria-expanded={open}
                          className="h-11 shrink-0 sm:h-9"
                        >
                          <Code2 size={15} /> <span className="hidden xs:inline">Integrate</span>
                          <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => revoke(k.id).then(() => toast('Key revoked'))} className="h-11 shrink-0 text-red-600 hover:bg-red-500/10 dark:text-red-400 sm:h-9"><Trash2 size={15} /> <span className="hidden xs:inline">Revoke</span></Button>
                      </div>
                      {open && <KeyIntegration k={k} plaintext={mine} />}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* Incoming webhooks */}
        {!DEMO_MODE && <WebhooksCard />}

        {/* Quickstart */}
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-bold text-content"><Terminal size={18} /> Quickstart</h2>
          <p className="mt-0.5 text-sm text-content-muted">Send your key on every request from your server (never from a browser).</p>
          <div className="mt-3 flex items-start gap-2">
            <pre className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-2xl bg-navy-950 p-4 text-xs leading-relaxed text-cyan-100">{curl}</pre>
            <Button size="sm" variant="subtle" onClick={() => copy(curl)} className="h-11 w-11 shrink-0 px-0 sm:h-9 sm:w-9"><Copy size={14} /></Button>
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
