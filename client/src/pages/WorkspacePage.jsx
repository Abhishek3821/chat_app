import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Inbox, ListTodo, UserRoundPlus, ScrollText } from 'lucide-react';
import api from '@/lib/api';
import { useWorkspace } from '@/store/useWorkspace';
import { PAGE_SHELL } from '@/lib/utils';

const tabs = [
  ['inbox', 'Team inbox', Inbox], ['tasks', 'Tasks', ListTodo],
  ['guests', 'Guests', UserRoundPlus], ['activity', 'Activity', ScrollText],
];
const field = 'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-content';
const button = 'rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';
const secondary = 'rounded-xl border border-border bg-surface px-3 py-2 text-sm text-content';
const card = 'rounded-2xl border border-border bg-surface p-4';
const error = (e) => toast.error(e?.response?.data?.message || e?.message || 'Something went wrong.');

export default function WorkspacePage() {
  const { workspace, myRole, members, load } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'inbox';
  const manager = ['owner', 'admin'].includes(myRole);
  useEffect(() => { load(); }, [load]);
  if (!workspace) return <div className="p-6 text-sm text-content-muted">Loading workspace…</div>;
  if (workspace?.type === 'personal') return <div className="p-6 text-content">These tools are available in team workspaces.</div>;
  return <div className="h-full overflow-y-auto"><div className={PAGE_SHELL}>
    <h1 className="text-2xl font-bold text-content">Workspace</h1>
    <p className="mt-1 text-sm text-content-muted">Team conversations, follow-ups and access.</p>
    <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{tabs.filter(([key]) => manager || !['guests', 'activity'].includes(key)).map(([key, label, Icon]) =>
      <button key={key} onClick={() => setParams({ tab: key })} className={`${tab === key ? button : secondary} flex shrink-0 items-center gap-2`}><Icon size={16}/>{label}</button>)}</div>
    {tab === 'inbox' && <InboxTab workspace={workspace} members={members} />}
    {tab === 'tasks' && <TasksTab members={members} />}
    {tab === 'guests' && manager && <GuestsTab members={members} />}
    {tab === 'activity' && manager && <ActivityTab />}
  </div></div>;
}

function InboxTab({ workspace, members }) {
  const [threads, setThreads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const load = async () => { try { setThreads((await api.get('/workspaces/me/inbox')).data.threads || []); } catch (e) { error(e); } };
  const open = async (id) => { try { setSelected(id); setDetail((await api.get(`/workspaces/me/inbox/${id}`)).data.thread); } catch (e) { error(e); } };
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    const socket = window.__ccSocket;
    const onUpdate = () => { load(); if (selected) open(selected); };
    if (socket) socket.on('workspace-inbox-updated', onUpdate);
    return () => { clearInterval(timer); if (socket) socket.off('workspace-inbox-updated', onUpdate); };
  }, [selected]);
  const postReply = async () => { try {
    await api.post(`/workspaces/me/inbox/${selected}/replies`, { text: reply });
    setReply(''); await open(selected); await load();
  } catch (e) { error(e); } };
  const postNote = async () => { try {
    await api.post(`/workspaces/me/inbox/${selected}/notes`, { text: note });
    setNote(''); await open(selected); await load();
  } catch (e) { error(e); } };
  const patch = async (change) => { try { await api.patch(`/workspaces/me/inbox/${selected}`, change); await open(selected); await load(); } catch (e) { error(e); } };
  const customerUrl = workspace?._id ? `${window.location.origin}/team/${workspace._id}` : '';
  return <div className="space-y-4">
    <div className={card}><p className="font-semibold text-content">Customer contact link</p><p className="mt-1 text-xs text-content-muted">Share this link with customers. Their messages arrive here, separate from private chats.</p><div className="mt-2 flex gap-2"><input readOnly value={customerUrl} className={field}/><button className={secondary} onClick={() => navigator.clipboard.writeText(customerUrl).then(() => toast.success('Link copied')).catch(error)}>Copy</button></div></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(230px,1fr)_minmax(0,2fr)]">
      <div className={`${card} space-y-2`}>{threads.length ? threads.map((t) => <button key={t._id} onClick={() => open(t._id)} className={`w-full rounded-xl p-3 text-left ${selected === t._id ? 'bg-brand-500/15' : 'hover:bg-content/5'}`}><div className="flex justify-between gap-2"><span className="font-medium text-content">{t.customer?.name || 'Customer'}</span><span className="text-xs text-content-muted">{t.status}</span></div><p className="truncate text-xs text-content-muted">{t.messages?.at(-1)?.text || 'No messages'}</p></button>) : <p className="text-sm text-content-muted">No customer conversations yet.</p>}</div>
      <div className={`${card} min-h-64`}>{detail ? <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><select aria-label="Thread status" className={field} value={detail.status} onChange={(e) => patch({ status: e.target.value })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select><select aria-label="Assigned teammate" className={field} value={detail.assignedTo?._id || ''} onChange={(e) => patch({ assignedTo: e.target.value })}><option value="">Unassigned</option>{members.filter((m) => m.workspaceRole !== 'guest' && m.accountStatus === 'active').map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></div>
        <div className="max-h-80 space-y-2 overflow-y-auto">{detail.messages?.map((m) => <div key={m._id} className="rounded-xl bg-content/5 p-2 text-sm text-content"><strong>{m.author?.name || 'User'}:</strong> {m.text}</div>)}</div>
        <div className="flex gap-2"><input aria-label="Reply to customer" className={field} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to customer"/><button className={button} disabled={!reply.trim()} onClick={postReply}>Send</button></div>
        <div className="border-t border-border pt-3"><p className="mb-2 text-sm font-semibold text-content">Internal notes (team only)</p>{detail.notes?.map((n) => <p key={n._id} className="mb-1 text-sm text-content-muted">{n.author?.name}: {n.text}</p>)}<div className="flex gap-2"><input aria-label="Internal note" className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note"/><button className={secondary} disabled={!note.trim()} onClick={postNote}>Add</button></div></div>
      </div> : <p className="text-sm text-content-muted">Select a conversation.</p>}</div>
    </div>
  </div>;
}

function TasksTab({ members }) {
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', assignee: '', dueAt: '' });
  const load = async () => { try { setTasks((await api.get('/workspaces/me/tasks')).data.tasks || []); } catch (e) { error(e); } };
  useEffect(() => {
    load();
    const socket = window.__ccSocket;
    if (socket) socket.on('workspace-task-updated', load);
    return () => { if (socket) socket.off('workspace-task-updated', load); };
  }, []);
  const create = async (e) => { e.preventDefault(); try { await api.post('/workspaces/me/tasks', { ...form, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }); setForm({ title: '', description: '', assignee: '', dueAt: '' }); await load(); toast.success('Task created'); } catch (err) { error(err); } };
  const update = async (id, change) => { try { await api.patch(`/workspaces/me/tasks/${id}`, change); await load(); } catch (e) { error(e); } };
  return <div className="space-y-4"><form className={`${card} grid gap-2 sm:grid-cols-2`} onSubmit={create}><input className={field} required maxLength={180} placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}/><input className={field} placeholder="Details (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/><select className={field} value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}><option value="">Unassigned</option>{members.filter((m) => m.workspaceRole !== 'guest' && m.accountStatus === 'active').map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select><input className={field} type="datetime-local" aria-label="Due date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}/><button className={button} type="submit">Create task</button></form>
    <div className="space-y-2">{tasks.map((t) => <div key={t._id} className={`${card} flex flex-wrap items-center gap-3`}><input type="checkbox" aria-label={`Complete ${t.title}`} checked={t.status === 'done'} onChange={(e) => update(t._id, { status: e.target.checked ? 'done' : 'open' })}/><div className="min-w-0 flex-1"><p className={t.status === 'done' ? 'text-content-muted line-through' : 'font-semibold text-content'}>{t.title}</p><p className="text-xs text-content-muted">{t.description} {t.dueAt && ` · Due ${new Date(t.dueAt).toLocaleString()}`}</p></div><select aria-label={`Assignee for ${t.title}`} className={`${field} max-w-44`} value={t.assignee?._id || ''} onChange={(e) => update(t._id, { assignee: e.target.value })}><option value="">Unassigned</option>{members.filter((m) => m.workspaceRole !== 'guest' && m.accountStatus === 'active').map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select><input aria-label={`Due date for ${t.title}`} className={`${field} max-w-56`} type="datetime-local" value={t.dueAt ? new Date(new Date(t.dueAt).getTime() - new Date(t.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => update(t._id, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })}/></div>)}{!tasks.length && <p className="text-sm text-content-muted">No team tasks yet.</p>}</div>
  </div>;
}

function GuestsTab() {
  const workspaceId = useWorkspace((s) => s.workspace?._id);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState('7');
  const [guests, setGuests] = useState([]);
  const [link, setLink] = useState('');
  const load = async () => { try { const [c, g] = await Promise.all([api.get('/chats'), api.get('/workspaces/me/guests')]); setGroups((c.data.chats || []).filter((chat) => chat.isGroup && String(chat.workspace) === String(workspaceId))); setGuests(g.data.guests || []); } catch (e) { error(e); } };
  useEffect(() => { if (workspaceId) load(); }, [workspaceId]);
  const invite = async () => { try { const { data } = await api.post('/workspaces/me/guests/invites', { chatIds: selected, days: days === 'never' ? null : Number(days) }); setLink(data.url.startsWith('/') ? `${window.location.origin}${data.url}` : data.url); toast.success('Guest link created'); } catch (e) { error(e); } };
  const revoke = async (id) => { if (!window.confirm('Revoke this guest’s access?')) return; try { await api.post(`/workspaces/me/guests/${id}/revoke`); await load(); } catch (e) { error(e); } };
  return <div className="space-y-4"><div className={card}><h2 className="font-semibold text-content">Invite a limited guest</h2><p className="mt-1 text-sm text-content-muted">Choose exactly which team groups the guest can see. The one-use signup link is valid for seven days; guest access can expire sooner or remain until revoked.</p><div className="mt-3 space-y-2">{groups.map((g) => <label key={g._id} className="flex gap-2 text-sm text-content"><input type="checkbox" checked={selected.includes(g._id)} onChange={(e) => setSelected(e.target.checked ? [...selected, g._id] : selected.filter((id) => id !== g._id))}/>{g.name}</label>)}{!groups.length && <p className="text-sm text-content-muted">Create a team group first.</p>}</div><div className="mt-3 flex gap-2"><select className={`${field} max-w-40`} aria-label="Guest access duration" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="never">Until revoked</option></select><button className={button} disabled={!selected.length} onClick={invite}>Create guest link</button></div>{link && <div className="mt-3 flex gap-2"><input className={field} readOnly value={link}/><button className={secondary} onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copied')).catch(error)}>Copy</button></div>}</div><div className={card}><h2 className="mb-3 font-semibold text-content">Guests</h2>{guests.map((g) => <div key={g._id} className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm"><span className="text-content">{g.name} · {g.email}<span className="block text-xs text-content-muted">{g.accountStatus} · {g.guestExpiresAt ? `Expires ${new Date(g.guestExpiresAt).toLocaleString()}` : 'Until revoked'}</span></span><button className={secondary} disabled={g.accountStatus !== 'active'} onClick={() => revoke(g._id)}>Revoke</button></div>)}{!guests.length && <p className="text-sm text-content-muted">No guests yet.</p>}</div></div>;
}

function ActivityTab() {
  const [events, setEvents] = useState([]);
  useEffect(() => { api.get('/workspaces/me/activity').then(({ data }) => setEvents(data.events || [])).catch(error); }, []);
  return <div className={card}><p className="mb-3 text-sm text-content-muted">Latest 200 team administration, inbox and task changes.</p>{events.map((event) => <div key={event._id} className="border-t border-border py-2 text-sm text-content"><strong>{event.actor?.name || 'Former member'}</strong> · {event.action} {event.detail && `· ${event.detail}`}<span className="block text-xs text-content-muted">{new Date(event.createdAt).toLocaleString()}</span></div>)}{!events.length && <p className="text-sm text-content-muted">No activity recorded yet.</p>}</div>;
}
