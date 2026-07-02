import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNowStrict } from 'date-fns';
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
import { Chip } from '@/components/ui/Badge';
import { cn, formatDuration } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import api, { DEMO_MODE } from '@/lib/api';
import { CALLS } from '@/lib/demoData';

const FILTERS = ['All', 'Missed', 'Incoming', 'Outgoing'];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};
const rowItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

/** Colored direction glyph describing the outcome of a call. */
function DirectionIcon({ call }) {
  const missed = call.status === 'missed' || call.status === 'rejected';
  if (missed) {
    return <PhoneMissed size={15} className="text-red-500" strokeWidth={2.4} />;
  }
  if (call.direction === 'outgoing') {
    return <PhoneOutgoing size={15} className="text-emerald-500" strokeWidth={2.4} />;
  }
  return <PhoneIncoming size={15} className="text-cyan-500" strokeWidth={2.4} />;
}

function CallRow({ call }) {
  const startCall = useUI((s) => s.startCall);
  const peer = call.peer || {};
  const missed = call.status === 'missed' || call.status === 'rejected';
  const TypeIcon = call.type === 'video' ? Video : Phone;

  const subtitleParts = [];
  subtitleParts.push(call.direction === 'outgoing' ? 'Outgoing' : 'Incoming');
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
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="group glass flex items-center gap-3 rounded-2xl p-3 shadow-soft sm:gap-4 sm:p-3.5"
    >
      <Avatar src={peer.avatar} name={peer.name} online={peer.isOnline} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={cn('truncate font-semibold', missed ? 'text-red-500' : 'text-content')}>
            {peer.name || 'Unknown'}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <DirectionIcon call={call} />
          <span className={cn('truncate', missed ? 'text-red-500/90' : 'text-content-muted')}>
            {subtitleParts.join(' · ')}
          </span>
        </div>
      </div>

      {/* Right side: meta on desktop (fades out on hover), always-on actions on mobile. */}
      <div className="relative flex items-center justify-end">
        {/* Meta — hidden on mobile (actions take over), fades on hover on desktop */}
        <div className="hidden flex-col items-end gap-1 pr-1 text-right transition-opacity group-hover:pointer-events-none group-hover:opacity-0 sm:flex">
          <div className="flex items-center gap-1.5 text-content-muted">
            <TypeIcon size={15} className={missed ? 'text-red-400' : 'text-brand-500'} />
            <span className="text-xs font-medium">
              {formatDistanceToNowStrict(new Date(call.createdAt), { addSuffix: true })}
            </span>
          </div>
          {call.duration > 0 && (
            <span className="text-[11px] font-medium text-content-muted/80">
              {formatDuration(call.duration)}
            </span>
          )}
        </div>

        {/* Quick call actions — always visible on mobile, revealed on hover on desktop */}
        <div className="flex items-center gap-1.5 opacity-100 transition-opacity sm:absolute sm:right-0 sm:opacity-0 sm:group-hover:opacity-100">
          <Button
            variant="glass"
            size="icon-sm"
            aria-label={`Audio call ${peer.name}`}
            onClick={() => launch('audio')}
          >
            <Phone size={16} className="text-emerald-500" />
          </Button>
          <Button
            variant="glass"
            size="icon-sm"
            aria-label={`Video call ${peer.name}`}
            onClick={() => launch('video')}
          >
            <Video size={16} className="text-brand-500" />
          </Button>
        </div>
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

  const missedCount = useMemo(
    () => calls.filter((c) => c.status === 'missed' || c.status === 'rejected').length,
    [calls]
  );

  const filtered = useMemo(() => {
    const sorted = [...calls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    switch (filter) {
      case 'Missed':
        return sorted.filter((c) => c.status === 'missed' || c.status === 'rejected');
      case 'Incoming':
        return sorted.filter((c) => c.direction === 'incoming');
      case 'Outgoing':
        return sorted.filter((c) => c.direction === 'outgoing');
      default:
        return sorted;
    }
  }, [filter, calls]);

  const handleNewCall = () => {
    // The new-call flow is handled by the contacts / new-chat modal elsewhere.
    openModal('newChat');
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
            <PhoneCall className="text-white" size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-content">Calls</h1>
            <p className="text-xs text-content-muted">
              {missedCount > 0 ? `${missedCount} missed · ` : ''}
              {calls.length} recent
            </p>
          </div>
        </div>

        <Button onClick={handleNewCall} className="shrink-0">
          <Phone size={17} />
          <span className="hidden sm:inline">New call</span>
        </Button>
      </motion.header>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="no-scrollbar mt-5 flex items-center gap-2 overflow-x-auto pb-1"
      >
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f}
            {f === 'Missed' && missedCount > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                  filter === f ? 'bg-white/25' : 'bg-red-500/15 text-red-500'
                )}
              >
                {missedCount}
              </span>
            )}
          </Chip>
        ))}
      </motion.div>

      {/* List */}
      {filtered.length > 0 ? (
        <motion.ul
          key={filter}
          variants={container}
          initial="hidden"
          animate="show"
          className="mt-5 space-y-2.5"
        >
          {filtered.map((call) => (
            <CallRow key={call._id} call={call} />
          ))}
        </motion.ul>
      ) : loading ? (
        <ul className="mt-5 space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="glass h-[68px] animate-pulse rounded-2xl" />
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
