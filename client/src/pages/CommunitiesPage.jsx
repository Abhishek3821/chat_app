import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Users2, ArrowLeft, Megaphone, Hash, LogOut, Copy, UserPlus, Layers } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { useCommunities } from '@/store/useCommunities';
import { useChat } from '@/store/useChat';
import { gradientFor, cn } from '@/lib/utils';

export default function CommunitiesPage() {
  const { communities, active, load, open, create, join, addGroup, leave } = useCommunities();
  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [modal, setModal] = useState(null); // 'create' | 'join'
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const setActiveChat = useChat((s) => s.setActiveChat);

  useEffect(() => { load(); }, [load]);

  const openCommunity = async (id) => {
    try {
      await open(id);
      setView('detail');
    } catch (e) {
      toast.error(e?.message || 'Could not open community.');
    }
  };

  const openGroup = (groupId) => {
    setActiveChat(groupId);
    navigate('/');
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        {view === 'list' ? (
          <>
            <motion.header
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl"><span className="gradient-text">Communities</span></h1>
                <p className="mt-1 text-sm text-content-muted">Bring related groups together under one roof, with an announcement channel everyone sees.</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="md" onClick={() => setModal('join')}><UserPlus size={17} /> Join</Button>
                <Button size="md" onClick={() => setModal('create')}><Plus size={18} /> New community</Button>
              </div>
            </motion.header>

            {communities.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-border">
                <EmptyState
                  icon={Users2}
                  title="No communities yet"
                  description="Create a community to organise multiple groups, or join one with an invite code."
                  action={<Button onClick={() => setModal('create')}><Plus size={18} /> Create a community</Button>}
                />
              </div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {communities.map((c) => (
                  <motion.button
                    key={c._id}
                    whileHover={{ y: -4 }}
                    onClick={() => openCommunity(c._id)}
                    className="glass group flex flex-col overflow-hidden rounded-3xl text-left shadow-soft transition-shadow hover:shadow-soft-lg"
                  >
                    <div className={cn('relative h-20 bg-gradient-to-br', gradientFor(c.name || c._id))}>
                      <div className="absolute inset-0 bg-mesh-dark opacity-40" />
                    </div>
                    <div className="-mt-8 px-5">
                      <Avatar src={c.avatar} name={c.name} size="lg" ring className="ring-2 ring-surface" />
                    </div>
                    <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
                      <h3 className="truncate text-base font-bold text-content">{c.name}</h3>
                      <p className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-xs text-content-muted">{c.description || 'A community of groups.'}</p>
                      <div className="mt-3 flex items-center gap-4 text-[11px] font-medium text-content-muted">
                        <span className="inline-flex items-center gap-1"><Users2 size={13} /> {c.memberCount}</span>
                        <span className="inline-flex items-center gap-1"><Layers size={13} /> {c.groupCount} groups</span>
                        {c.isAdmin && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-brand-600 dark:text-brand-300">Admin</span>}
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </>
        ) : (
          <CommunityDetail
            community={active}
            onBack={() => setView('list')}
            onOpenGroup={openGroup}
            onAddGroup={addGroup}
            onLeave={async (id) => { await leave(id); setView('list'); toast.success('Left community.'); }}
          />
        )}
      </div>

      {modal === 'create' && (
        <CreateCommunityModal
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (name, description) => {
            setBusy(true);
            try { const c = await create({ name, description }); setModal(null); await openCommunity(c._id); }
            catch (e) { toast.error(e?.message || 'Could not create community.'); }
            finally { setBusy(false); }
          }}
        />
      )}
      {modal === 'join' && (
        <JoinCommunityModal
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (code) => {
            setBusy(true);
            try { await join(code.trim()); setModal(null); toast.success('Joined community!'); }
            catch (e) { toast.error(e?.message || 'Could not join. Check the invite code.'); }
            finally { setBusy(false); }
          }}
        />
      )}
    </div>
  );
}

function CommunityDetail({ community, onBack, onOpenGroup, onAddGroup, onLeave }) {
  const [adding, setAdding] = useState(false);
  const [groupName, setGroupName] = useState('');
  if (!community) return null;
  const announcement = (community.groups || []).find((g) => g.isAnnouncement);
  const topics = (community.groups || []).filter((g) => !g.isAnnouncement);

  const copyInvite = () => {
    navigator.clipboard?.writeText(community.inviteCode).then(() => toast.success('Invite code copied.')).catch(() => {});
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-content-muted hover:text-content">
        <ArrowLeft size={16} /> All communities
      </button>

      <div className="glass-strong flex items-center gap-4 rounded-3xl p-5 shadow-soft">
        <Avatar src={community.avatar} name={community.name} size="xl" ring />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-content">{community.name}</h2>
          <p className="text-sm text-content-muted">{community.memberCount} members · {(community.groups || []).length} groups</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onLeave(community._id)} className="text-red-500 hover:bg-red-500/10">
          <LogOut size={16} /> Leave
        </Button>
      </div>

      {community.isAdmin && community.inviteCode && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-surface-2/60 p-3">
          <span className="text-xs font-medium text-content-muted">Invite code</span>
          <code className="flex-1 truncate rounded-lg bg-surface px-3 py-1.5 font-mono text-sm text-content">{community.inviteCode}</code>
          <Button variant="outline" size="sm" onClick={copyInvite}><Copy size={14} /> Copy</Button>
        </div>
      )}

      {announcement && (
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">Announcements</h3>
          <button
            onClick={() => onOpenGroup(announcement._id)}
            className="glass flex w-full items-center gap-3 rounded-2xl p-3.5 text-left shadow-soft transition hover:shadow-soft-lg"
          >
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow"><Megaphone size={20} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-content">{announcement.name}</p>
              <p className="text-xs text-content-muted">Admins post · everyone reads · {announcement.memberCount} members</p>
            </div>
          </button>
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">Groups</h3>
          {community.isAdmin && !adding && (
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-brand-600"><Plus size={14} /> Add group</button>
          )}
        </div>

        {community.isAdmin && adding && (
          <div className="mb-3 flex gap-2">
            <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" autoFocus />
            <Button
              size="md"
              disabled={!groupName.trim()}
              onClick={async () => { try { await onAddGroup(community._id, groupName.trim()); setGroupName(''); setAdding(false); toast.success('Group added.'); } catch (e) { toast.error(e?.message || 'Failed.'); } }}
            >Add</Button>
            <Button size="md" variant="ghost" onClick={() => { setAdding(false); setGroupName(''); }}>Cancel</Button>
          </div>
        )}

        {topics.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-content-muted">No topic groups yet.</p>
        ) : (
          <div className="grid gap-2">
            {topics.map((g) => (
              <button key={g._id} onClick={() => onOpenGroup(g._id)} className="glass flex items-center gap-3 rounded-2xl p-3 text-left transition hover:shadow-soft">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-content-muted"><Hash size={18} /></span>
                <div className="min-w-0 flex-1"><p className="truncate font-medium text-content">{g.name}</p><p className="text-xs text-content-muted">{g.memberCount} members</p></div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CreateCommunityModal({ onClose, onSubmit, busy }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <Modal open onClose={onClose} title="New community">
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Neighbourhood" autoFocus /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's it about?" /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={() => onSubmit(name.trim(), description.trim())}>{busy ? 'Creating…' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function JoinCommunityModal({ onClose, onSubmit, busy }) {
  const [code, setCode] = useState('');
  return (
    <Modal open onClose={onClose} title="Join a community">
      <div className="space-y-3">
        <Field label="Invite code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the invite code" autoFocus /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !code.trim()} onClick={() => onSubmit(code)}>{busy ? 'Joining…' : 'Join'}</Button>
        </div>
      </div>
    </Modal>
  );
}
