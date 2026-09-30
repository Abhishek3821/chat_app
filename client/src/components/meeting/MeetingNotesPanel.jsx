import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useWorkspace } from '../../store/useWorkspace';

export default function MeetingNotesPanel({ meetingId, open, onClose }) {
  const isTeamWorkspace = useWorkspace((s) => s.workspace?.type === 'team');
  const [notes, setNotes] = useState('');
  const [version, setVersion] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    try {
      const { data } = await api.get(`/meetings/${meetingId}/notes`);
      setNotes(data.notes || '');
      setVersion(data.updatedAt || null);
      setDirty(false);
    } catch (err) { toast.error(err?.response?.data?.message || 'Could not load meeting notes.'); }
  };
  useEffect(() => { if (open) reload(); }, [meetingId, open]);
  useEffect(() => {
    const socket = window.__ccSocket;
    if (!socket) return undefined;
    const onUpdate = (event) => {
      if (String(event.meetingId) !== String(meetingId)) return;
      if (dirty) { toast('Meeting notes changed. Save or reload to resolve.'); return; }
      setNotes(event.notes || '');
      setVersion(event.updatedAt || null);
    };
    socket.on('meeting-notes', onUpdate);
    return () => socket.off('meeting-notes', onUpdate);
  }, [meetingId, dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/meetings/${meetingId}/notes`, { notes, updatedAt: version });
      setVersion(data.updatedAt);
      setDirty(false);
      toast.success('Meeting notes saved.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save meeting notes.');
    } finally { setSaving(false); }
  };

  const createTask = async () => {
    if (dirty) return toast.error('Save the notes first.');
    const title = window.prompt('Task title from these meeting notes');
    if (!title?.trim()) return;
    try { await api.post('/workspaces/me/tasks', { title: title.trim(), description: notes.slice(0, 3000), source: { kind: 'meeting', id: meetingId } }); toast.success('Team task created'); }
    catch (e) { toast.error(e?.response?.data?.message || 'Could not create task.'); }
  };

  if (!open) return null;
  return (
    <aside className="absolute inset-0 z-30 flex flex-col bg-navy-950 p-4 sm:static sm:w-80 sm:border-l sm:border-white/10 lg:w-96">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Shared notes</h2>
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-white/70 hover:text-white" aria-label="Close notes">Close</button>
      </div>
      <p className="mb-3 text-xs text-white/60">Everyone in this meeting can edit these notes.</p>
      <textarea
        value={notes}
        maxLength={20000}
        onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
        className="min-h-0 flex-1 resize-none rounded-xl border border-white/15 bg-white/5 p-3 text-base text-white outline-none focus:border-brand-500"
        placeholder="Decisions, action items, and links…"
      />
      <div className="mt-3 flex gap-2">
        <button onClick={reload} className="rounded-xl bg-white/10 px-4 py-2 text-sm">Reload</button>
        {isTeamWorkspace && <button onClick={createTask} disabled={dirty || !notes.trim()} className="rounded-xl bg-white/10 px-4 py-2 text-sm disabled:opacity-50">Create task</button>}
        <button onClick={save} disabled={!dirty || saving} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save notes'}</button>
      </div>
    </aside>
  );
}
