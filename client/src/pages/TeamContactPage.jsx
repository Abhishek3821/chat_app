import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuth } from '@/store/useAuth';

export default function TeamContactPage() {
  const { workspaceId } = useParams();
  const user = useAuth((s) => s.user);
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const load = async () => {
    try {
      const { data } = await api.get('/workspaces/customer/inbox');
      const mine = (data.threads || []).find((t) => String(t.workspace?._id) === workspaceId);
      if (mine) setThread((await api.get(`/workspaces/me/inbox/${mine._id}`)).data.thread);
    } catch (e) { toast.error(e?.response?.data?.message || 'Could not load the conversation.'); }
  };
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [workspaceId]);
  const send = async (e) => { e.preventDefault(); if (!text.trim()) return; try { if (thread) await api.post(`/workspaces/me/inbox/${thread._id}/replies`, { text }); else await api.post(`/workspaces/${workspaceId}/inbox`, { text }); setText(''); await load(); } catch (err) { toast.error(err?.response?.data?.message || 'Could not send.'); } };
  return <div className="min-h-screen bg-[rgb(var(--app-bg))] p-4 text-content"><div className="mx-auto max-w-2xl"><Link className="text-sm text-brand-500" to="/">← Back to chats</Link><h1 className="mt-3 text-2xl font-bold">Contact {thread?.workspace?.name || 'the team'}</h1><p className="mt-1 text-sm text-content-muted">Signed in as {user?.name}. This is a shared team conversation.</p><div className="mt-5 min-h-80 space-y-2 rounded-2xl border border-border bg-surface p-4">{thread?.messages?.map((m) => <div key={m._id} className="rounded-xl bg-content/5 p-2 text-sm"><strong>{m.author?.name || 'Team'}:</strong> {m.text}</div>)}{!thread && <p className="text-sm text-content-muted">Send your first message below.</p>}</div><form onSubmit={send} className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2" aria-label="Message to team" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder="Write your message"/><button className="rounded-xl bg-brand-500 px-4 py-2 font-semibold text-white" disabled={!text.trim()}>Send</button></form></div></div>;
}
