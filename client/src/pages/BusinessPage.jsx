import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Store, Package, Clock, Tag, Zap, Plus, Trash2, Pencil, BadgeCheck, ShieldAlert } from 'lucide-react';

import Button from '@/components/ui/Button';
import { Input, Textarea, Field } from '@/components/ui/Input';
import Switch from '@/components/ui/Switch';
import EmptyState from '@/components/ui/EmptyState';
import { useWorkspace } from '@/store/useWorkspace';
import { useBusiness } from '@/store/useBusiness';

const TABS = [
  { key: 'profile', label: 'Profile', icon: Store },
  { key: 'catalog', label: 'Catalog', icon: Package },
  { key: 'auto', label: 'Auto-replies', icon: Clock },
  { key: 'labels', label: 'Labels', icon: Tag },
  { key: 'quick', label: 'Quick replies', icon: Zap },
];

export default function BusinessPage() {
  const { workspace, myRole, load: loadWs } = useWorkspace();
  const business = useBusiness();
  const [tab, setTab] = useState('profile');

  useEffect(() => { loadWs(); business.load(); /* eslint-disable-next-line */ }, []);

  const canManage = myRole === 'owner' || myRole === 'admin';
  const isPersonal = workspace?.type === 'personal';

  if (isPersonal) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState icon={Store} title="Business tools are for team workspaces" description="Personal accounts don't have a business storefront. Create or join a team workspace to use the catalog, labels and auto-replies." />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow"><Store size={22} /></span>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
              <span className="gradient-text">{workspace?.name || 'Business'}</span>
              {workspace?.businessProfile?.verified && <BadgeCheck size={22} className="text-brand-500" title="Verified business" />}
            </h1>
            <p className="text-sm text-content-muted">Your WhatsApp-Business storefront and agent tools.</p>
          </div>
        </motion.header>

        {!canManage && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <ShieldAlert size={16} /> You can view these tools, but only owners/admins can edit them.
          </div>
        )}

        <div className="mt-5 flex gap-1.5 overflow-x-auto scrollbar-thin">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'bg-brand-gradient text-white shadow-glow' : 'text-content-muted hover:bg-content/5 hover:text-content'}`}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'profile' && <ProfileTab workspace={workspace} canManage={canManage} />}
          {tab === 'catalog' && <CatalogTab business={business} canManage={canManage} />}
          {tab === 'auto' && <AutoTab workspace={workspace} canManage={canManage} />}
          {tab === 'labels' && <LabelsTab business={business} canManage={canManage} />}
          {tab === 'quick' && <QuickTab business={business} canManage={canManage} />}
        </div>
      </div>
    </div>
  );
}

function Card({ children }) {
  return <div className="glass rounded-3xl p-5 shadow-soft">{children}</div>;
}

function ProfileTab({ workspace, canManage }) {
  const updateBusiness = useWorkspace((s) => s.updateBusiness);
  const bp = workspace?.businessProfile || {};
  const [form, setForm] = useState({ category: '', description: '', hours: '', address: '', website: '', email: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm({ category: bp.category || '', description: bp.description || '', hours: bp.hours || '', address: bp.address || '', website: bp.website || '', email: bp.email || '' }); /* eslint-disable-next-line */ }, [workspace?._id]);

  const save = async () => {
    setBusy(true);
    try { await updateBusiness({ businessProfile: form }); toast.success('Business profile saved.'); }
    catch (e) { toast.error(e?.message || 'Could not save.'); }
    finally { setBusy(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category"><Input value={form.category} onChange={set('category')} placeholder="e.g. Retail" disabled={!canManage} /></Field>
        <Field label="Hours"><Input value={form.hours} onChange={set('hours')} placeholder="Mon–Fri 9–5" disabled={!canManage} /></Field>
        <Field label="Website"><Input value={form.website} onChange={set('website')} placeholder="https://…" disabled={!canManage} /></Field>
        <Field label="Contact email"><Input value={form.email} onChange={set('email')} placeholder="hello@acme.com" disabled={!canManage} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><Input value={form.address} onChange={set('address')} placeholder="Street, city" disabled={!canManage} /></Field></div>
        <div className="sm:col-span-2"><Field label="About"><Textarea rows={3} value={form.description} onChange={set('description')} placeholder="What your business does…" disabled={!canManage} /></Field></div>
      </div>
      {canManage && <div className="mt-4 flex justify-end"><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button></div>}
    </Card>
  );
}

function CatalogTab({ business, canManage }) {
  const [editing, setEditing] = useState(null); // product or {} for new
  const blank = { name: '', price: '', currency: 'USD', description: '', link: '', images: [] };

  const save = async (form) => {
    try {
      if (editing._id) await business.updateProduct(editing._id, form);
      else await business.addProduct(form);
      setEditing(null);
      toast.success('Saved.');
    } catch (e) { toast.error(e?.message || 'Could not save.'); }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end"><Button size="md" onClick={() => setEditing(blank)}><Plus size={17} /> Add product</Button></div>
      )}
      {business.products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border"><EmptyState icon={Package} title="No products yet" description="Add items to your catalog to share them in chats." /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {business.products.map((p) => (
            <Card key={p._id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-content">{p.name}</p>
                  <p className="text-sm text-brand-600 dark:text-brand-300">{p.price ? `${p.currency} ${p.price}` : 'Free'}{!p.inStock && <span className="ml-2 text-xs text-red-500">Out of stock</span>}</p>
                  {p.description && <p className="mt-1 line-clamp-2 text-xs text-content-muted">{p.description}</p>}
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setEditing({ ...p, price: String(p.price ?? '') })} className="grid h-8 w-8 place-items-center rounded-lg text-content-muted hover:bg-content/10 hover:text-content"><Pencil size={15} /></button>
                    <button onClick={() => business.deleteProduct(p._id).then(() => toast.success('Deleted.'))} className="grid h-8 w-8 place-items-center rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <ProductEditor initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function ProductEditor({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ name: initial.name || '', price: initial.price || '', currency: initial.currency || 'USD', description: initial.description || '', link: initial.link || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card>
      <p className="mb-3 font-semibold text-content">{initial._id ? 'Edit product' : 'New product'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Name"><Input value={form.name} onChange={set('name')} autoFocus /></Field></div>
        <Field label="Price"><Input type="number" min="0" value={form.price} onChange={set('price')} /></Field>
        <Field label="Currency"><Input value={form.currency} onChange={set('currency')} /></Field>
        <div className="sm:col-span-2"><Field label="Link (optional)"><Input value={form.link} onChange={set('link')} placeholder="https://…" /></Field></div>
        <div className="sm:col-span-2"><Field label="Description"><Textarea rows={2} value={form.description} onChange={set('description')} /></Field></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !form.name.trim()} onClick={async () => { setBusy(true); await onSave({ ...form, price: Number(form.price) || 0 }); setBusy(false); }}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Card>
  );
}

function AutoTab({ workspace, canManage }) {
  const updateBusiness = useWorkspace((s) => s.updateBusiness);
  const ar = workspace?.autoReplies || {};
  const [greeting, setGreeting] = useState({ enabled: false, text: '' });
  const [away, setAway] = useState({ enabled: false, text: '', startHour: 9, endHour: 18 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setGreeting({ enabled: !!ar.greeting?.enabled, text: ar.greeting?.text || '' });
    setAway({ enabled: !!ar.away?.enabled, text: ar.away?.text || '', startHour: ar.away?.startHour ?? 9, endHour: ar.away?.endHour ?? 18 });
    /* eslint-disable-next-line */
  }, [workspace?._id]);

  const save = async () => {
    setBusy(true);
    try { await updateBusiness({ autoReplies: { greeting, away: { ...away, startHour: Number(away.startHour), endHour: Number(away.endHour) } } }); toast.success('Auto-replies saved.'); }
    catch (e) { toast.error(e?.message || 'Could not save.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div><p className="font-semibold text-content">Greeting message</p><p className="text-xs text-content-muted">Sent automatically the first time a customer messages you.</p></div>
          <Switch checked={greeting.enabled} onChange={(v) => setGreeting((g) => ({ ...g, enabled: v }))} disabled={!canManage} />
        </div>
        <Textarea rows={2} className="mt-3" value={greeting.text} onChange={(e) => setGreeting((g) => ({ ...g, text: e.target.value }))} placeholder="Hi! Thanks for reaching out. We'll reply shortly." disabled={!canManage} />
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <div><p className="font-semibold text-content">Away message</p><p className="text-xs text-content-muted">Sent when customers message outside business hours.</p></div>
          <Switch checked={away.enabled} onChange={(v) => setAway((a) => ({ ...a, enabled: v }))} disabled={!canManage} />
        </div>
        <Textarea rows={2} className="mt-3" value={away.text} onChange={(e) => setAway((a) => ({ ...a, text: e.target.value }))} placeholder="We're away right now and will respond during business hours." disabled={!canManage} />
        <div className="mt-3 flex items-center gap-3">
          <Field label="Open (hour)"><Input type="number" min="0" max="23" value={away.startHour} onChange={(e) => setAway((a) => ({ ...a, startHour: e.target.value }))} disabled={!canManage} className="w-24" /></Field>
          <Field label="Close (hour)"><Input type="number" min="0" max="23" value={away.endHour} onChange={(e) => setAway((a) => ({ ...a, endHour: e.target.value }))} disabled={!canManage} className="w-24" /></Field>
        </div>
      </Card>
      {canManage && <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save auto-replies'}</Button></div>}
    </div>
  );
}

function LabelsTab({ business, canManage }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Field label="New label"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New customer" /></Field></div>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-border bg-surface-2" />
            <Button size="md" disabled={!name.trim()} onClick={async () => { try { await business.addLabel(name.trim(), color); setName(''); } catch (e) { toast.error(e?.message || 'Failed.'); } }}><Plus size={17} /></Button>
          </div>
        </Card>
      )}
      {business.labels.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border"><EmptyState icon={Tag} title="No labels yet" description="Create labels to organise your customer chats." /></div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {business.labels.map((l) => (
            <span key={l._id} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pl-2.5 pr-1.5 text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: l.color }} />
              <span className="text-content">{l.name}</span>
              {canManage && <button onClick={() => business.deleteLabel(l._id)} className="grid h-6 w-6 place-items-center rounded-full text-content-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={13} /></button>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickTab({ business, canManage }) {
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');
  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <div className="space-y-2">
            <Field label="Shortcut"><Input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/thanks" /></Field>
            <Field label="Message"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Thanks for your order! …" /></Field>
            <div className="flex justify-end">
              <Button size="md" disabled={!shortcut.trim() || !text.trim()} onClick={async () => { try { await business.addQuickReply(shortcut.trim(), text.trim()); setShortcut(''); setText(''); } catch (e) { toast.error(e?.message || 'Failed.'); } }}><Plus size={17} /> Add</Button>
            </div>
          </div>
        </Card>
      )}
      {business.quickReplies.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border"><EmptyState icon={Zap} title="No quick replies yet" description="Save canned responses your agents can insert with a shortcut." /></div>
      ) : (
        <div className="grid gap-2">
          {business.quickReplies.map((q) => (
            <Card key={q._id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><code className="rounded bg-brand-500/10 px-1.5 py-0.5 font-mono text-xs text-brand-600 dark:text-brand-300">/{q.shortcut}</code><p className="mt-1 text-sm text-content">{q.text}</p></div>
                {canManage && <button onClick={() => business.deleteQuickReply(q._id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 size={15} /></button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
