import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Search,
  UserPlus,
  MessageCircle,
  Phone,
  Video,
  Star,
  Check,
  X,
  Sparkles,
  Users,
  Clock,
  Loader2,
} from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import { cn, formatLastSeen } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { useContacts } from '@/store/useContacts';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } } };
const rise = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } } };

export default function ContactsPage() {
  const navigate = useNavigate();
  const { startCall, openModal } = useUI();
  const { contacts, favorites, incoming, outgoing, results, searching, load, search, clearResults, sendRequest, respond, toggleFavorite, startChat } =
    useContacts();

  const [query, setQuery] = useState('');

  useEffect(() => {
    load();
  }, [load]);

  // Debounced people search (searches everyone, not just contacts).
  useEffect(() => {
    if (!query.trim()) {
      clearResults();
      return undefined;
    }
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search, clearResults]);

  const contactIds = useMemo(() => new Set(contacts.map((c) => c._id)), [contacts]);
  const outgoingIds = useMemo(() => new Set(outgoing.map((r) => r.to?._id)), [outgoing]);
  const favIds = useMemo(() => new Set(favorites.map((f) => f._id || f)), [favorites]);

  const message = async (user) => {
    try {
      await startChat(user);
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Could not open chat');
    }
  };

  const add = async (user) => {
    try {
      await sendRequest(user._id);
      toast.success(`Request sent to ${user.name}`);
    } catch (err) {
      toast.error(err.message || 'Could not send request');
    }
  };

  const onRespond = async (req, action) => {
    try {
      await respond(req._id, action);
      if (action === 'accept') toast.success(`${req.from.name} is now a contact`);
      else toast(`Declined ${req.from.name}`);
    } catch (err) {
      toast.error(err?.message || 'Could not update the request');
    }
  };

  const grouped = useMemo(() => {
    const map = new Map();
    [...contacts]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .forEach((u) => {
        const letter = (u.name?.[0] || '#').toUpperCase();
        if (!map.has(letter)) map.set(letter, []);
        map.get(letter).push(u);
      });
    return [...map.entries()];
  }, [contacts]);

  const favoriteUsers = contacts.filter((u) => favIds.has(u._id));
  const searchMode = query.trim().length > 0;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl"><span className="gradient-text">Contacts</span></h1>
            <p className="mt-1 text-sm text-content-muted">{contacts.length} connections · search anyone by email, username or phone to connect</p>
          </div>
        </motion.header>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="mt-6">
          <Input
            icon={searching ? Loader2 : Search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find people by name, @username, email or phone number…"
          />
        </motion.div>

        {/* ── Search results (find people to add) ── */}
        {searchMode && (
          <section className="mt-6">
            <SectionTitle icon={UserPlus} title="People" />
            <div className="mt-3 space-y-2">
              {results.map((u) => {
                const isContact = contactIds.has(u._id);
                const pending = outgoingIds.has(u._id);
                return (
                  <motion.div key={u._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass flex items-center gap-3.5 rounded-2xl p-3 shadow-soft">
                    <Avatar src={u.avatar} name={u.name} size="md" online={u.isOnline} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-content">{u.name}</p>
                      {/* email/phone are contact-gated by the API — only shown for existing contacts */}
                      <p className="truncate text-xs text-content-muted">@{u.username}{u.email ? ` · ${u.email}` : ''}{u.phone ? ` · ${u.phone}` : ''}</p>
                    </div>
                    {isContact ? (
                      <Button size="sm" variant="subtle" onClick={() => message(u)}><MessageCircle size={15} /> Message</Button>
                    ) : pending ? (
                      <Button size="sm" variant="outline" disabled><Clock size={15} /> Requested</Button>
                    ) : (
                      <Button size="sm" onClick={() => add(u)}><UserPlus size={15} /> Add</Button>
                    )}
                  </motion.div>
                );
              })}
              {!searching && results.length === 0 && (
                <p className="py-8 text-center text-sm text-content-muted">No people match “{query}”.</p>
              )}
            </div>
          </section>
        )}

        {!searchMode && (
          <>
            {/* ── Incoming requests ── */}
            <AnimatePresence initial={false}>
              {incoming.length > 0 && (
                <motion.section key="requests" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-8 overflow-hidden">
                  <SectionTitle icon={Sparkles} title="Contact requests">
                    <span className="ml-2 rounded-full bg-brand-gradient px-2 py-0.5 text-[11px] font-bold text-white shadow-glow">{incoming.length}</span>
                  </SectionTitle>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <AnimatePresence mode="popLayout">
                      {incoming.map((req) => (
                        <motion.div key={req._id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, x: 40 }} className="glass flex items-center gap-3 rounded-2xl p-3.5 shadow-soft">
                          <Avatar src={req.from.avatar} name={req.from.name} size="lg" ring />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-content">{req.from.name}</p>
                            <p className="truncate text-xs text-content-muted">{req.message || `@${req.from.username} wants to connect`}</p>
                            <div className="mt-2.5 flex gap-2">
                              <Button size="sm" className="px-3" onClick={() => onRespond(req, 'accept')}><Check size={15} /> Accept</Button>
                              <Button size="sm" variant="outline" className="px-3" onClick={() => onRespond(req, 'reject')}><X size={15} /> Decline</Button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            {/* ── Favorites ── */}
            {favoriteUsers.length > 0 && (
              <section className="mt-8">
                <SectionTitle icon={Star} title="Favorites" />
                <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-2">
                  {favoriteUsers.map((user) => (
                    <motion.button key={user._id} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} onClick={() => openModal('profile', user)} className="glass relative flex w-32 shrink-0 flex-col items-center gap-2 rounded-2xl p-4 text-center shadow-soft">
                      <span className="absolute right-2 top-2 text-amber-400"><Star size={15} className="fill-amber-400" /></span>
                      <Avatar src={user.avatar} name={user.name} size="lg" online={user.isOnline} ring />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-content">{user.name?.split(' ')[0]}</p>
                        <p className="truncate text-[11px] text-content-muted">@{user.username}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </section>
            )}

            {/* ── All contacts A-Z ── */}
            <section className="mt-8 pb-6">
              <SectionTitle icon={Users} title="All contacts" />
              {grouped.length === 0 ? (
                <div className="mt-4 rounded-3xl border border-dashed border-border">
                  <EmptyState
                    icon={UserPlus}
                    title="No contacts yet"
                    description="Search for people by email, username or phone number above and send them a request. Once accepted, you can chat and call."
                  />
                </div>
              ) : (
                <motion.div variants={container} initial="hidden" animate="show" className="mt-3">
                  {grouped.map(([letter, users]) => (
                    <div key={letter} className="mb-4">
                      <div className="sticky top-0 z-10 -mx-1 mb-1 bg-[rgb(var(--app-bg))]/80 px-1 py-1 backdrop-blur">
                        <span className="inline-grid h-7 w-7 place-items-center rounded-lg bg-brand-500/10 text-xs font-bold text-brand-600 dark:text-brand-300">{letter}</span>
                      </div>
                      <div className="space-y-2">
                        {users.map((user) => (
                          <ContactRow
                            key={user._id}
                            user={user}
                            isFavorite={favIds.has(user._id)}
                            onOpen={() => openModal('profile', user)}
                            onMessage={() => message(user)}
                            onAudio={() => startCall({ type: 'audio', peer: user, direction: 'outgoing' })}
                            onVideo={() => startCall({ type: 'video', peer: user, direction: 'outgoing' })}
                            onToggleFavorite={async () => { const f = await toggleFavorite(user._id); toast(f ? 'Added to favorites' : 'Removed from favorites'); }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, children }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={17} className="text-brand-500" />}
      <h2 className="text-sm font-bold uppercase tracking-wide text-content-muted">{title}</h2>
      {children}
    </div>
  );
}

function ContactRow({ user, isFavorite, onOpen, onMessage, onAudio, onVideo, onToggleFavorite }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn?.(); };
  const subtitle = user.isOnline ? user.bio || `@${user.username}` : formatLastSeen(user.lastSeen);
  return (
    <motion.div variants={rise} whileHover={{ scale: 1.005 }} onClick={onOpen} className="glass group flex cursor-pointer items-center gap-3.5 rounded-2xl p-3 shadow-soft transition-shadow hover:shadow-soft-lg">
      <Avatar src={user.avatar} name={user.name} size="md" online={user.isOnline} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-semibold text-content">{user.name}</p>
          {isFavorite && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}
        </div>
        <p className="truncate text-xs text-content-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <RowAction label="Message" onClick={stop(onMessage)}><MessageCircle size={17} /></RowAction>
        <RowAction label="Audio call" onClick={stop(onAudio)}><Phone size={17} /></RowAction>
        <RowAction label="Video call" onClick={stop(onVideo)}><Video size={17} /></RowAction>
        <RowAction label={isFavorite ? 'Unfavorite' : 'Favorite'} onClick={stop(onToggleFavorite)} active={isFavorite}>
          <Star size={17} className={cn(isFavorite && 'fill-amber-400 text-amber-400')} />
        </RowAction>
      </div>
    </motion.div>
  );
}

function RowAction({ children, label, onClick, active }) {
  return (
    <motion.button whileTap={{ scale: 0.88 }} whileHover={{ scale: 1.08 }} onClick={onClick} aria-label={label} title={label}
      className={cn('ring-brand grid h-9 w-9 place-items-center rounded-xl transition-colors', active ? 'text-amber-500' : 'text-content-muted hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-300')}>
      {children}
    </motion.button>
  );
}
