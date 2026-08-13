import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Send, Eye, ChevronLeft, ChevronRight, Camera } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import { cn, formatRelative, PAGE_SHELL } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { useStatus } from '@/store/useStatus';
import { useAuth } from '@/store/useAuth';

const STORY_DURATION = 4000; // ms per item

// Relative labels come from the shared safe helper. This page used to call
// date-fns directly on `new Date(value)`, which THROWS "Invalid time value" on a
// missing/unparseable date and took the whole screen down via the error boundary.
// formatRelative() returns '' instead (see safeDate in lib/utils).

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

  /* Count a view when the item actually comes ON SCREEN — one per item, as the
     story advances. Opening a story used to fire a view for every item it
     contained at once, so a 5-item story scored 5 views from someone who saw
     only the first. Own stories are skipped (the server ignores self-views too,
     this just saves the round trip). */
  const markViewed = useStatus((s) => s.view);
  useEffect(() => {
    if (item?._id && !entry?.isMe) markViewed(item._id);
  }, [item?._id, entry?.isMe, markViewed]);

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
        className="relative flex h-full max-h-[100dvh] w-full max-w-md flex-col overflow-hidden sm:my-4 sm:h-[92dvh] sm:rounded-3xl"
      >
        {/* Content background */}
        <div className="absolute inset-0" style={{ background: item.background }} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/50 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Progress bars — full-bleed on phones, so clear the notch/status bar. */}
        <div className="relative z-20 flex gap-1 px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] xs:gap-1.5 sm:pt-3">
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
            <p className="text-[11px] text-white/70 drop-shadow">{formatRelative(item.createdAt)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15 sm:h-10 sm:w-10"
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
          className="relative z-[5] flex flex-1 items-center justify-center px-6 sm:px-8"
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

        {/* Footer: viewers (own status) or reply bar. Full-bleed on phones — clear
            the iOS home indicator so the reply field stays tappable. */}
        <div className="relative z-20 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
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
                placeholder={`Reply to ${String(entry.user.name ?? '').split(' ')[0] || 'them'}…`}
                className="h-11 min-w-0 flex-1 rounded-full border border-white/25 bg-white/10 px-4 text-base text-white placeholder:text-white/60 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-white/40 sm:text-sm"
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
function StatusCard({ entry, onOpen, className }) {
  const preview = entry.items[0];
  const seen = entry.seenAll;
  return (
    <motion.button
      whileHover={{ scale: 1.03, y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      onClick={onOpen}
      // w-32 at base: two of these tiles side by side (add + my status) overflow a
      // 320px viewport at w-36. `className` lets the Recent grid stretch them to
      // their cell instead (w-full) — same tile, two layouts.
      className={cn(
        'relative h-48 w-32 shrink-0 overflow-hidden rounded-3xl text-left shadow-soft xs:h-52 xs:w-36',
        className
      )}
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
        <p className="text-[11px] text-white/80 drop-shadow">{formatRelative(preview.createdAt)}</p>
      </div>
    </motion.button>
  );
}

/** Uppercase section label + optional count — the same rhythm every section on
 *  this page now uses (they were three slightly different <p> tags before). */
function SectionLabel({ children, count }) {
  return (
    <div className="flex items-center gap-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-content-muted">{children}</p>
      {count > 0 && (
        <span className="rounded-full bg-content/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-content-muted">
          {count}
        </span>
      )}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Metric({ value, label }) {
  return (
    <div className="min-w-0">
      <p className="text-2xl font-bold leading-none tabular-nums text-content">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-content-muted">{label}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */
export default function StatusPage() {
  const openModal = useUI((s) => s.openModal);
  const { feed, load, markSeen } = useStatus();
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
      // Views are recorded per item by the viewer as each one is shown, not in
      // a batch here — see the effect in StoryViewer.
      if (!entry.isMe) markSeen(entry.user?._id);
    }
  };

  const myCount = myEntry?.items?.length || 0;

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        icon={Camera}
        title="Status"
        subtitle="Share a moment — disappears in 24 hours."
        actions={
          <Button onClick={() => openModal('newStatus')}>
            <Plus size={17} />
            <span className="hidden sm:inline">Add status</span>
          </Button>
        }
      />

      {/* ── Your status ── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="mt-6"
      >
        <SectionLabel>Your status</SectionLabel>
        <div className="mt-3 flex items-stretch gap-3 xs:gap-4">
          {/* Add status — dashed accent frame */}
          <motion.button
            whileHover={{ scale: 1.03, y: -3 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            onClick={() => openModal('newStatus')}
            className="group relative h-48 w-32 shrink-0 overflow-hidden rounded-3xl xs:h-52 xs:w-36"
          >
            <span className="absolute inset-0 rounded-3xl bg-brand-gradient-soft" aria-hidden />
            <span className="relative flex h-full w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-brand-500/50 transition-colors group-hover:border-brand-500">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient shadow-glow transition-transform group-hover:scale-110">
                <Plus className="text-white" size={24} strokeWidth={2.5} />
              </span>
              <span className="text-sm font-semibold text-content">Add status</span>
            </span>
          </motion.button>

          {/* My status card (if posted) else a matching prompt tile */}
          {hasMyStatus ? (
            <StatusCard entry={myEntry} onOpen={() => openViewer(myEntry)} />
          ) : (
            <button
              onClick={() => openModal('newStatus')}
              className="glass flex h-48 w-32 shrink-0 flex-col items-center justify-center gap-3 rounded-3xl text-center shadow-soft transition-colors hover:border-brand-500/40 xs:h-52 xs:w-36"
            >
              <Avatar src={me?.avatar} name={me?.name} size="lg" />
              <div>
                <p className="text-sm font-semibold text-content">My status</p>
                <p className="mt-0.5 text-[11px] text-content-muted">Tap to share</p>
              </div>
            </button>
          )}

          {/* Live summary instead of the old full-width "No new updates" box —
              that box was an empty state sitting directly above the page's other
              empty state, so a quiet Status screen rendered both at once. */}
          <div className="glass hidden min-w-0 flex-1 flex-col justify-center gap-3 rounded-3xl p-5 shadow-soft sm:flex">
            <div className="flex items-center gap-2 text-content-muted">
              <Eye size={16} className="text-brand-500" />
              <p className="text-xs font-bold uppercase tracking-wider">At a glance</p>
            </div>
            <div className="flex flex-wrap gap-6">
              <Metric value={myCount} label={myCount === 1 ? 'Update by you' : 'Updates by you'} />
              <Metric value={recent.length} label="Unseen" />
              <Metric value={viewed.length} label="Viewed" />
            </div>
            <p className="text-xs text-content-muted">
              {hasMyStatus
                ? 'Your status disappears 24 hours after you post it.'
                : 'Post a status and your contacts will see it for the next 24 hours.'}
            </p>
          </div>
        </div>
      </motion.section>

      {/* ── Recent updates — one responsive grid (was a desktop strip plus a
             separate mobile-only strip rendering the same list twice). ── */}
      {recent.length > 0 && (
        <section className="mt-8">
          <SectionLabel count={recent.length}>Recent updates</SectionLabel>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 xs:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] xs:gap-4">
            {recent.map((entry) => (
              <StatusCard
                key={entry.user._id}
                entry={entry}
                onOpen={() => openViewer(entry)}
                className="w-full xs:w-full"
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Viewed updates ── */}
      {viewed.length > 0 && (
        <section className="mt-8">
          <SectionLabel count={viewed.length}>Viewed updates</SectionLabel>
          {/* Rows are self-contained cards, so they column up rather than stretching
              to the full 1536px ceiling on a wide monitor. */}
          <div className="mt-3 grid gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
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
                    <p className="truncate text-xs text-content-muted">{formatRelative(preview.createdAt)}</p>
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

      {/* The page's ONLY empty state — reached when no contact has posted. */}
      {recent.length === 0 && viewed.length === 0 && (
        <div className="mt-8">
          <div className="glass mx-auto grid max-w-md place-items-center gap-4 rounded-3xl p-6 text-center shadow-soft xs:p-8">
            <span className="grid h-14 w-14 place-items-center rounded-3xl bg-brand-gradient shadow-glow">
              <Camera className="text-white" size={26} />
            </span>
            <div>
              <h3 className="text-base font-bold text-content">No updates from your contacts</h3>
              <p className="mt-1 text-sm text-content-muted">
                When someone shares a status, it will show up here for 24 hours.
              </p>
            </div>
            {!hasMyStatus && (
              <Button size="sm" onClick={() => openModal('newStatus')}>
                <Plus size={16} /> Share the first one
              </Button>
            )}
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
