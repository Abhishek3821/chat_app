import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Megaphone, Plus, Trash2, Send, ArrowLeft, Check } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input, Textarea, Field } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { useBroadcasts } from '@/store/useBroadcasts';
import { useContacts } from '@/store/useContacts';
import { cn } from '@/lib/utils';

export default function BroadcastsPage() {
  const { lists, load, create, remove, send } = useBroadcasts();
  const { contacts, load: loadContacts } = useContacts();
  const [creating, setCreating] = useState(false);
  const [sendTo, setSendTo] = useState(null); // list being composed to

  useEffect(() => { load(); loadContacts(); }, [load, loadContacts]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow"><Megaphone size={22} /></span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl"><span className="gradient-text">Broadcast lists</span></h1>
              <p className="text-sm text-content-muted">Message many contacts at once — each reply stays private, in its own chat.</p>
            </div>
          </div>
          <Button size="md" onClick={() => setCreating(true)} className="shrink-0"><Plus size={17} /> New list</Button>
        </motion.header>

        {lists.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-border">
            <EmptyState icon={Megaphone} title="No broadcast lists yet" description="Create a list of contacts to send announcements to everyone at once." action={<Button onClick={() => setCreating(true)}><Plus size={18} /> New list</Button>} />
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {lists.map((l) => (
              <div key={l._id} className="glass flex items-center gap-3 rounded-2xl p-4 shadow-soft">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500/10 text-brand-500"><Megaphone size={19} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-content">{l.name}</p>
                  <p className="text-xs text-content-muted">{l.recipientCount} {l.recipientCount === 1 ? 'recipient' : 'recipients'}</p>
                </div>
                <Button variant="subtle" size="sm" onClick={() => setSendTo(l)}><Send size={14} /> Send</Button>
                <button onClick={() => remove(l._id).then(() => toast.success('List deleted.'))} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-red-500 hover:bg-red-500/10"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateListModal
          contacts={contacts}
          onClose={() => setCreating(false)}
          onCreate={async (name, ids) => { try { await create(name, ids); setCreating(false); toast.success('Broadcast list created.'); } catch (e) { toast.error(e?.message || 'Failed.'); } }}
        />
      )}
      {sendTo && (
        <SendModal
          list={sendTo}
          onClose={() => setSendTo(null)}
          onSend={async (content) => { try { const r = await send(sendTo._id, content); setSendTo(null); toast.success(`Sent to ${r.sent} ${r.sent === 1 ? 'contact' : 'contacts'}.`); } catch (e) { toast.error(e?.message || 'Failed to send.'); } }}
        />
      )}
    </div>
  );
}

function CreateListModal({ contacts, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal open onClose={onClose} title="New broadcast list" subtitle="Pick the contacts to include." size="md">
      <div className="space-y-3 py-1">
        <Field label="List name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Loyal customers" autoFocus /></Field>
        <div className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
          {contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">No contacts yet.</p>
          ) : contacts.map((c) => (
            <button key={c._id} onClick={() => toggle(c._id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-content/5">
              <Avatar src={c.avatar} name={c.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-content">{c.name}</span><span className="block truncate text-xs text-content-muted">@{c.username}</span></span>
              <span className={cn('grid h-6 w-6 place-items-center rounded-full border', selected.includes(c._id) ? 'border-brand-500 bg-brand-500 text-white' : 'border-border')}>{selected.includes(c._id) && <Check size={14} />}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim() || selected.length === 0} onClick={async () => { setBusy(true); await onCreate(name.trim(), selected); setBusy(false); }}>{busy ? 'Creating…' : `Create (${selected.length})`}</Button>
        </div>
      </div>
    </Modal>
  );
}

function SendModal({ list, onClose, onSend }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Broadcast to ${list.name}`} subtitle={`${list.recipientCount} recipients · each gets it privately`} size="md">
      <div className="space-y-3 py-1">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your announcement…" autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !text.trim()} onClick={async () => { setBusy(true); await onSend(text.trim()); setBusy(false); }}><Send size={15} /> {busy ? 'Sending…' : 'Send'}</Button>
        </div>
      </div>
    </Modal>
  );
}
