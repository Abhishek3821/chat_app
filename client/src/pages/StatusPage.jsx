import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNowStrict } from 'date-fns';
import { Plus, X, Send, Eye, ChevronLeft, ChevronRight, Camera } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { useStatus } from '@/store/useStatus';
import { useAuth } from '@/store/useAuth';

const STORY_DURATION = 4000; // ms per item

const relTime = (date) => formatDistanceToNowStrict(new Date(date), { addSuffix: false });

/* ─────────────────────────────────────────────────────────────
   Full-screen story viewer (inline)
   ───────────────────────────────────────────────────────────── */
function StoryViewer({ feed, index, onClose, onChangeIndex }) {
  const entry = feed[index];
  const [itemIndex, setItemIndex] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 for the current item
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);

  const items = entry?.items ?? [];
  const item = items[itemIndex];

  // Reset item pointer whenever we switch users.
  useEffect(() => {
    setItemIndex(0);
    setProgress(0);
    elapsedRef.current = 0;
  }, [index]);

  const goNextUser = useCallback(() => {
    if (index < feed.length - 1) onChangeIndex(index + 1);
    else onClose();
  }, [index, feed.length, onChangeIndex, onClose]);

  const goPrevUser = useCallback(() => {
    if (index > 0) onChangeIndex(index - 1);
  }, [index, onChangeIndex]);

  const nextItem = useCallback(() => {
    elapsedRef.current = 0;
    setProgress(0);
    setItemIndex((i) => {
      if (i < items.length - 1) return i + 1;
      goNextUser();
      return i;
    });
  }, [items.length, goNextUser]);

  const prevItem = useCallback(() => {
    elapsedRef.current = 0;
    setProgress(0);
    setItemIndex((i) => {
      if (i > 0) return i - 1;
      goPrevUser();
      return i;
    });
  }, [goPrevUser]);

  // Timer driving auto-advance + progress bar via rAF (respects pause).
  useEffect(() => {
    if (!item) return undefined;
    cancelAnimationFrame(rafRef.current);
    startRef.current = performance.now();

    const tick = (t) => {
      if (paused) {
        startRef.current = t - elapsedRef.current;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      elapsedRef.current = t - startRef.current;
      const p = Math.min(elapsedRef.current / STORY_DURATION, 1);
      setProgress(p);
      if (p >= 1) {
        nextItem();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [item, itemIndex, index, paused, nextItem]);

  // Keyboard controls.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') nextItem();
      else if (e.key === 'ArrowLeft') prevItem();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, nextItem, prevItem]);

  const sendReply = (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setReply('');
  };

  if (!entry || !item) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full max-h-[100dvh] w-full max-w-md flex-col overflow-hidden sm:my-4 sm:h-[92vh] sm:rounded-3xl"
      >
        {/* Content background */}
        <div className="absolute inset-0" style={{ background: item.background }} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/50 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Progress bars */}
        <div className="relative z-20 flex gap-1.5 px-3 pt-3">
          {items.map((it, i) => (
            <div key={it._id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full bg-white"
                style={{
                  width: i < itemIndex ? '100%' : i === itemIndex ? `${progress * 100}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="relative z-20 flex items-center gap-3 px-4 pt-3">
          <Avatar src={entry.user.avatar} name={entry.user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white drop-shadow">
              {entry.isMe ? 'My status' : entry.user.name}
            </p>
            <p className="text-[11px] text-white/70 drop-shadow">{relTime(item.createdAt)} ago</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tap zones */}
        <button
          aria-label="Previous"
          className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-default"
          onClick={prevItem}
        />
        <button
          aria-label="Next"
          className="absolute inset-y-0 right-0 z-10 w-1/3 cursor-default"
          onClick={nextItem}
        />

        {/* Centered content — hold anywhere to pause */}
        <div
          className="relative z-[5] flex flex-1 items-center justify-center px-8"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          <AnimatePresence mode="wait">
            <motion.p
              key={item._id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.25 }}
              className="text-center text-2xl font-bold leading-snug text-white drop-shadow-lg sm:text-3xl"
            >
              {item.content}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Footer: viewers (own status) or reply bar */}
        <div className="relative z-20 px-4 pb-4">
          {entry.isMe ? (
            <div className="flex items-center justify-center gap-2 text-white/85">
              <Eye size={16} />
              <span className="text-sm font-medium">
                {item.viewers?.length || 0} view{(item.viewers?.length || 0) === 1 ? '' : 's'}
              </span>
              {item.viewers?.length > 0 && (
                <div className="ml-1 flex -space-x-2">
                  {item.viewers.slice(0, 4).map((v, i) => {
                    const vu = v.user || v; // real mode: {user, at}; demo: full user
                    return (
                      <div key={vu._id || i} className="rounded-full ring-2 ring-black/30">
                        <Avatar src={vu.avatar} name={vu.name} size="xs" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={sendReply} className="flex items-center gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                placeholder={`Reply to ${entry.user.name.split(' ')[0]}…`}
                className="h-11 flex-1 rounded-full border border-white/25 bg-white/10 px-4 text-sm text-white placeholder:text-white/60 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-white/40"
              />
              <button
                type="submit"
                aria-label="Send reply"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-brand-600 transition-transform active:scale-95"
              >
                <Send size={18} />
              </button>
            </form>
          )}
        </div>

        {/* Desktop prev/next affordances */}
        {index > 0 && (
          <button
            onClick={goPrevUser}
            aria-label="Previous person"
            className="absolute -left-14 top-1/2 z-30 hidden -translate-y-1/2 place-items-center rounded-full bg-white/10 p-3 text-white backdrop-blur-md transition-colors hover:bg-white/20 sm:grid"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {index < feed.length - 1 && (
          <button
            onClick={goNextUser}
            aria-label="Next person"
            className="absolute -right-14 top-1/2 z-30 hidden -translate-y-1/2 place-items-center rounded-full bg-white/10 p-3 text-white backdrop-blur-md transition-colors hover:bg-white/20 sm:grid"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Status card in the grid/strip
   ───────────────────────────────────────────────────────────── */
function StatusCard({ entry, onOpen }) {
  const preview = entry.items[0];
  const seen = entry.seenAll;
  return (
    <motion.button
      whileHover={{ scale: 1.03, y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      onClick={onOpen}
      className="relative h-52 w-36 shrink-0 overflow-hidden rounded-3xl text-left shadow-soft"
      style={{ background: preview.background }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />

      {/* Avatar with gradient (or muted) ring */}
      <div className="absolute left-3 top-3">
        <div
          className={cn(
            'rounded-full p-[2px]',
            seen ? 'bg-content-muted/50' : 'bg-brand-gradient'
          )}
        >
          <div className="rounded-full p-[2px] ring-2 ring-black/10">
            <Avatar src={entry.user.avatar} name={entry.user.name} size="sm" />
          </div>
        </div>
      </div>

      {entry.items.length > 1 && (
        <span className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          {entry.items.length}
        </span>
      )}

      <div className="absolute inset-x-3 bottom-3">
        <p className="truncate text-sm font-semibold text-white drop-shadow">
          {entry.isMe ? 'My status' : entry.user.name}
        </p>
        <p className="text-[11px] text-white/80 drop-shadow">{relTime(preview.createdAt)} ago</p>
      </div>
    </motion.button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */
export default function StatusPage() {
  const openModal = useUI((s) => s.openModal);
  const { feed, load, view, markSeen } = useStatus();
  const me = useAuth((s) => s.user);
  const [viewerIndex, setViewerIndex] = useState(null); // index into `feed` or null

  useEffect(() => {
    load();
  }, [load]);

  const myEntry = useMemo(() => feed.find((e) => e.isMe), [feed]);
  const others = useMemo(() => feed.filter((e) => !e.isMe), [feed]);
  const recent = useMemo(() => others.filter((e) => !e.seenAll), [others]);
  const viewed = useMemo(() => others.filter((e) => e.seenAll), [others]);

  const hasMyStatus = (myEntry?.items?.length || 0) > 0;

  const openViewer = (entry) => {
    const idx = feed.indexOf(entry);
    if (idx >= 0) {
      setViewerIndex(idx);
      entry.items?.forEach((it) => view(it._id));
      if (!entry.isMe) markSeen(entry.user?._id);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <h1 className="text-2xl font-bold tracking-tight text-content">Status</h1>
        <p className="text-xs text-content-muted">Share a moment — disappears in 24 hours.</p>
      </motion.header>

      {/* My status + add tile */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="mt-6 flex items-stretch gap-4"
      >
        {/* Add status — dashed gradient border tile */}
        <motion.button
          whileHover={{ scale: 1.03, y: -3 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          onClick={() => openModal('newStatus')}
          className="group relative h-52 w-36 shrink-0 overflow-hidden rounded-3xl"
        >
          {/* Soft gradient glow behind the dashed frame */}
          <span className="absolute inset-0 rounded-3xl bg-brand-gradient-soft" aria-hidden />
          <span className="relative flex h-full w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-brand-500/50 transition-colors group-hover:border-brand-500">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient shadow-glow transition-transform group-hover:scale-110">
              <Plus className="text-white" size={24} strokeWidth={2.5} />
            </span>
            <span className="text-sm font-semibold text-content">Add status</span>
          </span>
        </motion.button>

        {/* My status card (if posted) else a prompt */}
        {hasMyStatus ? (
          <StatusCard entry={myEntry} onOpen={() => openViewer(myEntry)} />
        ) : (
          <button
            onClick={() => openModal('newStatus')}
            className="glass flex h-52 w-36 shrink-0 flex-col items-center justify-center gap-3 rounded-3xl text-center shadow-soft"
          >
            <Avatar src={me?.avatar} name={me?.name} size="lg" />
            <div>
              <p className="text-sm font-semibold text-content">My status</p>
              <p className="mt-0.5 text-[11px] text-content-muted">Tap to share</p>
            </div>
          </button>
        )}

        {/* Recent updates strip (fills remaining width on larger screens) */}
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-content-muted">
            Recent updates
          </p>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {recent.length > 0 ? (
              recent.map((entry) => (
                <StatusCard key={entry.user._id} entry={entry} onOpen={() => openViewer(entry)} />
              ))
            ) : (
              <div className="glass grid h-52 w-full place-items-center rounded-3xl text-sm text-content-muted">
                No new updates
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Recent updates — mobile (below the tiles) */}
      {recent.length > 0 && (
        <section className="mt-8 md:hidden">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-content-muted">
            Recent updates
          </p>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {recent.map((entry) => (
              <StatusCard key={entry.user._id} entry={entry} onOpen={() => openViewer(entry)} />
            ))}
          </div>
        </section>
      )}

      {/* Viewed updates */}
      {viewed.length > 0 && (
        <section className="mt-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-content-muted">
            Viewed updates
          </p>
          <div className="space-y-2.5">
            {viewed.map((entry) => {
              const preview = entry.items[0];
              return (
                <motion.button
                  key={entry.user._id}
                  whileHover={{ scale: 1.01 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  onClick={() => openViewer(entry)}
                  className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left shadow-soft"
                >
                  <div className="rounded-full bg-content-muted/40 p-[2px]">
                    <div className="rounded-full ring-2 ring-surface">
                      <Avatar src={entry.user.avatar} name={entry.user.name} size="md" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-content">{entry.user.name}</p>
                    <p className="truncate text-xs text-content-muted">{relTime(preview.createdAt)} ago</p>
                  </div>
                  <div
                    className="h-10 w-8 shrink-0 rounded-lg"
                    style={{ background: preview.background }}
                    aria-hidden
                  />
                </motion.button>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty overall state */}
      {recent.length === 0 && viewed.length === 0 && (
        <div className="mt-10">
          <div className="glass mx-auto grid max-w-md place-items-center gap-4 rounded-3xl p-10 text-center shadow-soft">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-gradient shadow-glow">
              <Camera className="text-white" size={28} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-content">No updates yet</h3>
              <p className="mt-1 text-sm text-content-muted">
                When your contacts share a status, it will show up here.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen viewer */}
      <AnimatePresence>
        {viewerIndex !== null && (
          <StoryViewer
            feed={feed}
            index={viewerIndex}
            onChangeIndex={setViewerIndex}
            onClose={() => setViewerIndex(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
