import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuth } from '@/store/useAuth';

const box = 'rounded-xl border border-border bg-surface p-3';

export default function GuestPortal() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [chats, setChats] = useState([]);
  const [active, setActive] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const refresh = async () => {
    try {
      const { data } = await api.get('/chats');
      setChats(data.chats || []);
      setActive((id) => id || data.chats?.[0]?._id || '');
    } catch (e) { toast.error(e?.response?.data?.message || 'Could not load your groups.'); }
  };
  const loadMessages = async (id) => { if (!id) return; try { setMessages((await api.get(`/messages/${id}`)).data.messages || []); } catch (e) { toast.error(e?.response?.data?.message || 'Could not load messages.'); } };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { loadMessages(active); const timer = setInterval(() => loadMessages(active), 8000); return () => clearInterval(timer); }, [active]);
  const send = async (e) => { e.preventDefault(); if (!text.trim() || !active) return; try { await api.post('/messages', { chatId: active, type: 'text', content: text.trim() }); setText(''); await loadMessages(active); } catch (err) { toast.error(err?.response?.data?.message || 'Could not send.'); } };
  return <div className="min-h-screen bg-[rgb(var(--app-bg))] p-4 text-content"><div className="mx-auto max-w-5xl"><header className="mb-4 flex items-center justify-between"><div><h1 className="text-2xl font-bold">Guest groups</h1><p className="text-sm text-content-muted">Welcome, {user?.name}. You can see only the groups shared with you. Guest replies are text-only.</p></div><button className={box} onClick={logout}>Log out</button></header><div className="grid gap-4 md:grid-cols-[250px_1fr]"><div className={`${box} space-y-1`}>{chats.map((chat) => <button key={chat._id} onClick={() => setActive(chat._id)} className={`block w-full rounded-lg p-2 text-left ${active === chat._id ? 'bg-brand-500/15' : 'hover:bg-content/5'}`}>{chat.name}</button>)}{!chats.length && <p className="text-sm text-content-muted">No invited groups are available.</p>}</div><div className={`${box} flex min-h-[60vh] flex-col`}><h2 className="border-b border-border pb-2 font-semibold">{chats.find((c) => c._id === active)?.name || 'Select a group'}</h2><div className="flex-1 space-y-2 overflow-y-auto py-3">{messages.map((m) => <div key={m._id} className="rounded-xl bg-content/5 p-2 text-sm"><strong>{m.sender?.name || 'Member'}:</strong> {m.content || (m.attachments?.length ? 'Attachment (not available in guest view)' : 'Non-text message')}</div>)}</div><form onSubmit={send} className="flex gap-2"><input aria-label="Message" className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2" value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} placeholder="Type a message"/><button disabled={!active || !text.trim()} className="rounded-xl bg-brand-500 px-4 py-2 text-white disabled:opacity-50">Send</button></form></div></div><p className="mt-4 text-xs text-content-muted">Access expires {user?.guestExpiresAt ? new Date(user.guestExpiresAt).toLocaleString() : 'when revoked'}.</p></div></div>;
}
