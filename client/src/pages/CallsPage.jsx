import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Phone,
  Video,
  PhoneOutgoing,
  PhoneIncoming,
  PhoneMissed,
  PhoneCall,
} from 'lucide-react';
import toast from 'react-hot-toast';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import { Chip } from '@/components/ui/Badge';
import { cn, formatDateSeparator, formatDuration, formatTime, PAGE_SHELL } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import api, { DEMO_MODE } from '@/lib/api';
import { CALLS } from '@/lib/demoData';

const FILTERS = ['All', 'Missed', 'Incoming', 'Outgoing'];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};
const rowItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

const isMissed = (c) => c.status === 'missed' || c.status === 'rejected';

/** Colored direction glyph describing the outcome of a call. */
function DirectionIcon({ call }) {
  if (isMissed(call)) return <PhoneMissed size={14} className="text-red-500" strokeWidth={2.4} />;
  if (call.direction === 'outgoing')
    return <PhoneOutgoing size={14} className="text-emerald-500" strokeWidth={2.4} />;
  return <PhoneIncoming size={14} className="text-cyan-500" strokeWidth={2.4} />;
}

function CallRow({ call }) {
  const startCall = useUI((s) => s.startCall);
  const peer = call.peer || {};
  const missed = isMissed(call);
  const TypeIcon = call.type === 'video' ? Video : Phone;

  const subtitleParts = [call.direction === 'outgoing' ? 'Outgoing' : 'Incoming'];
  if (call.status === 'rejected') subtitleParts.push('Declined');
  else if (missed) subtitleParts.push('Missed');

  const launch = (type) => {
    if (!peer._id) return;
    startCall({ type, peer, direction: 'outgoing' });
    toast.success(`Calling ${peer.name}…`);
  };

  return (
    <motion.li
      variants={rowItem}
      className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-content/[0.035] sm:gap-3.5 sm:px-4"
    >
      <Avatar src={peer.avatar} name={peer.name} online={peer.isOnline} size="md" />

      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-semibold', missed ? 'text-red-500' : 'text-content')}>
          {peer.name || 'Unknown'}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <DirectionIcon call={call} />
          <span className={cn('truncate', missed ? 'text-red-500/90' : 'text-content-muted')}>
            {subtitleParts.join(' · ')}
          </span>
        </div>
      </div>

      {/* Meta stays visible at every width. It used to be `hidden sm:flex` and
          faded out on hover, so on a phone a call row showed no time at all and
          on desktop the time vanished the moment you reached for the buttons. */}
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-content-muted">
          <TypeIcon size={14} className={missed ? 'text-red-400' : 'text-brand-500'} />
          {formatTime(call.createdAt)}
        </span>
        {call.duration > 0 && (
          <span className="text-[11px] font-medium tabular-nums text-content-muted/80">
            {formatDuration(call.duration)}
          </span>
        )}
      </div>

      {/* Actions sit in their own column rather than absolutely on top of the
          meta, so nothing overlaps and nothing shifts on hover. Muted until the
          row is hovered/focused — always tappable on touch. */}
      <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          variant="glass"
          size="icon-sm"
          aria-label={`Audio call ${peer.name || 'contact'}`}
          onClick={() => launch('audio')}
        >
          <Phone size={16} className="text-emerald-500" />
        </Button>
        <Button
          variant="glass"
          size="icon-sm"
          className="hidden xs:inline-flex"
          aria-label={`Video call ${peer.name || 'contact'}`}
          onClick={() => launch('video')}
        >
          <Video size={16} className="text-brand-500" />
        </Button>
      </div>
    </motion.li>
  );
}

export default function CallsPage() {
  const [filter, setFilter] = useState('All');
  const [calls, setCalls] = useState(DEMO_MODE ? CALLS : []);
  const [loading, setLoading] = useState(!DEMO_MODE);
  const openModal = useUI((s) => s.openModal);
  const activeCall = useUI((s) => s.call);

  // Real call history from the API; refreshed whenever a call finishes
  // (activeCall flips back to null) so new entries appear immediately.
  useEffect(() => {
    if (DEMO_MODE || activeCall) return undefined;
    let stale = false;
    (async () => {
      try {
        const { data } = await api.get('/calls/history');
        if (!stale) setCalls(data.calls || []);
      } catch {
        /* keep whatever is already shown */
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [activeCall]);

  const counts = useMemo(
    () => ({
      All: calls.length,
      Missed: calls.filter(isMissed).length,
      Incoming: calls.filter((c) => c.direction === 'incoming').length,
      Outgoing: calls.filter((c) => c.direction === 'outgoing').length,
    }),
    [calls]
  );

  const filtered = useMemo(() => {
    const sorted = [...calls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    switch (filter) {
      case 'Missed':
        return sorted.filter(isMissed);
      case 'Incoming':
        return sorted.filter((c) => c.direction === 'incoming');
      case 'Outgoing':
        return sorted.filter((c) => c.direction === 'outgoing');
      default:
        return sorted;
    }
  }, [filter, calls]);

  /* Group by day. A history like the one this screen actually shows — twenty
     rows all reading "8 days ago" — is unreadable as a flat list; with day
     headers the row itself only has to carry the clock time. */
  const days = useMemo(() => {
    const map = new Map();
    for (const c of filtered) {
      const key = formatDateSeparator(c.createdAt) || 'Earlier';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return [...map.entries()];
  }, [filtered]);

  const handleNewCall = () => {
    // The new-call flow is handled by the contacts / new-chat modal elsewhere.
    openModal('newChat');
  };

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        icon={PhoneCall}
        title="Calls"
        subtitle={`${counts.Missed > 0 ? `${counts.Missed} missed · ` : ''}${calls.length} recent`}
        actions={
          <Button onClick={handleNewCall}>
            <Phone size={17} />
            <span className="hidden sm:inline">New call</span>
          </Button>
        }
      />

      {/* Filters — each carries its own count, so you can see there's nothing
          under a tab before switching to it. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="no-scrollbar mt-5 flex items-center gap-2 overflow-x-auto pb-1"
      >
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f}
            {counts[f] > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                  filter === f
                    ? 'bg-white/25'
                    : f === 'Missed'
                      ? 'bg-red-500/15 text-red-500'
                      : 'bg-content/10'
                )}
              >
                {counts[f]}
              </span>
            )}
          </Chip>
        ))}
      </motion.div>

      {/* One card per day with hairline-separated rows, instead of 20 floating
          cards each carrying its own border + shadow. */}
      {days.length > 0 ? (
        <motion.div key={filter} variants={container} initial="hidden" animate="show" className="mt-5 space-y-5">
          {days.map(([label, items]) => (
            <section key={label}>
              <div className="mb-2 flex items-center gap-3 px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">
                  {label}
                </span>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-semibold tabular-nums text-content-muted/70">
                  {items.length}
                </span>
              </div>
              <ul className="card divide-y divide-border overflow-hidden shadow-soft">
                {items.map((call) => (
                  <CallRow key={call._id} call={call} />
                ))}
              </ul>
            </section>
          ))}
        </motion.div>
      ) : loading ? (
        <ul className="card mt-5 divide-y divide-border overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-3 p-3">
              <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-content/10" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-32 animate-pulse rounded-full bg-content/10" />
                <span className="block h-2.5 w-20 animate-pulse rounded-full bg-content/10" />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-10">
          <EmptyState
            icon={PhoneMissed}
            title={`No ${filter.toLowerCase()} calls`}
            description={
              filter === 'Missed'
                ? "You're all caught up — no missed calls here."
                : `You have no ${filter.toLowerCase()} calls yet. Start one to see it here.`
            }
            action={
              <Button onClick={handleNewCall}>
                <Phone size={17} />
                Start a call
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
