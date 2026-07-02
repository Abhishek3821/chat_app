import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format, isToday, isTomorrow, isSameDay, addDays } from 'date-fns';
import {
  CalendarDays,
  Video,
  Phone,
  Clock,
  Repeat,
  MoreHorizontal,
  Plus,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { MEETINGS } from '@/lib/demoData';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const cardItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 26 } },
};

/** Human label for a day used as a section header. */
function dayLabel(date) {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEEE, d MMMM');
}

/** Overlapping stack of participant avatars, capped with a "+N". */
function ParticipantStack({ people = [], max = 4 }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((p) => (
        <div key={p._id} className="rounded-full ring-2 ring-surface">
          <Avatar src={p.avatar} name={p.name} size="sm" />
        </div>
      ))}
      {extra > 0 && (
        <div className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-content-muted ring-2 ring-surface">
          +{extra}
        </div>
      )}
    </div>
  );
}

function TypeChip({ type }) {
  const isVideo = type === 'video';
  const Icon = isVideo ? Video : Phone;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        isVideo
          ? 'bg-brand-gradient text-white shadow-glow'
          : 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'
      )}
    >
      <Icon size={12} strokeWidth={2.4} />
      {isVideo ? 'Video' : 'Audio'}
    </span>
  );
}

function MeetingCard({ meeting }) {
  const startCall = useUI((s) => s.startCall);
  const start = new Date(meeting.startAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60 * 1000);
  const soon = isToday(start);

  const join = () => {
    // Join opens the call overlay with the host as the peer.
    startCall({ type: meeting.type, peer: meeting.host, direction: 'outgoing' });
    toast.success(`Joining “${meeting.title}”`);
  };

  return (
    <motion.article
      variants={cardItem}
      whileHover={{ scale: 1.01, y: -2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="glass-strong relative overflow-hidden rounded-3xl p-5 shadow-soft"
    >
      {/* Ambient gradient accent */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-gradient opacity-10 blur-2xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip type={meeting.type} />
          {meeting.recurrence !== 'none' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold capitalize text-violet-600 dark:text-violet-300">
              <Repeat size={12} strokeWidth={2.4} />
              {meeting.recurrence}
            </span>
          )}
          {soon && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Today
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Meeting options"
          onClick={() => toast('Meeting options', { icon: '⚙️' })}
          className="shrink-0"
        >
          <MoreHorizontal size={18} />
        </Button>
      </div>

      <h3 className="relative mt-3 text-lg font-bold leading-snug text-content">{meeting.title}</h3>
      {meeting.description && (
        <p className="relative mt-1 line-clamp-2 text-sm text-content-muted">{meeting.description}</p>
      )}

      <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-content-muted">
        <span className="inline-flex items-center gap-1.5 font-medium text-content">
          <CalendarDays size={15} className="text-brand-500" />
          {format(start, 'EEE, d MMM')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={15} className="text-brand-500" />
          {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={15} className="text-brand-500" />
          {meeting.participants.length + 1}
        </span>
      </div>

      <div className="relative mt-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ParticipantStack people={[meeting.host, ...meeting.participants]} />
          <p className="min-w-0 truncate text-xs text-content-muted">
            Hosted by <span className="font-semibold text-content">{meeting.host.name}</span>
          </p>
        </div>

        <Button onClick={join} className="shrink-0">
          {meeting.type === 'video' ? <Video size={17} /> : <Phone size={17} />}
          Join
        </Button>
      </div>
    </motion.article>
  );
}

export default function MeetingsPage() {
  const openModal = useUI((s) => s.openModal);
  const [selectedDay, setSelectedDay] = useState(null); // Date | null (null = show all upcoming)

  const sorted = useMemo(
    () => [...MEETINGS].sort((a, b) => new Date(a.startAt) - new Date(b.startAt)),
    []
  );

  // The next 7 days for the calendar strip.
  const week = useMemo(() => {
    const base = new Date();
    return Array.from({ length: 7 }, (_, i) => addDays(base, i));
  }, []);

  const hasMeetingOn = (day) => sorted.some((m) => isSameDay(new Date(m.startAt), day));

  const visible = useMemo(() => {
    if (!selectedDay) return sorted;
    return sorted.filter((m) => isSameDay(new Date(m.startAt), selectedDay));
  }, [sorted, selectedDay]);

  // Group visible meetings by day for section headers.
  const groups = useMemo(() => {
    const map = new Map();
    for (const m of visible) {
      const key = format(new Date(m.startAt), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, { date: new Date(m.startAt), items: [] });
      map.get(key).items.push(m);
    }
    return [...map.values()];
  }, [visible]);

  const schedule = () => openModal('scheduleMeeting');

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
            <CalendarDays className="text-white" size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-content">Meetings</h1>
            <p className="text-xs text-content-muted">{sorted.length} upcoming</p>
          </div>
        </div>

        <Button onClick={schedule} className="shrink-0">
          <Plus size={17} />
          <span className="hidden sm:inline">Schedule meeting</span>
          <span className="sm:hidden">Schedule</span>
        </Button>
      </motion.header>

      {/* 7-day calendar strip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="no-scrollbar mt-6 flex gap-2.5 overflow-x-auto pb-1"
      >
        {week.map((day) => {
          const today = isToday(day);
          const active = selectedDay ? isSameDay(day, selectedDay) : today;
          const dot = hasMeetingOn(day);
          return (
            <motion.button
              key={day.toISOString()}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedDay((prev) => (prev && isSameDay(prev, day) ? null : day))}
              className={cn(
                'relative grid h-[76px] w-16 shrink-0 place-items-center rounded-2xl border transition-colors',
                active
                  ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                  : 'glass border-border text-content hover:bg-white/80 dark:hover:bg-white/10'
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide',
                  active ? 'text-white/80' : 'text-content-muted'
                )}
              >
                {format(day, 'EEE')}
              </span>
              <span className="text-xl font-bold leading-none">{format(day, 'd')}</span>
              {dot && (
                <span
                  className={cn(
                    'absolute bottom-2 h-1.5 w-1.5 rounded-full',
                    active ? 'bg-white' : 'bg-brand-500'
                  )}
                />
              )}
            </motion.button>
          );
        })}
      </motion.div>

      {/* Section: Upcoming / filtered */}
      <div className="mt-7 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-content-muted">
          {selectedDay ? dayLabel(selectedDay) : 'Upcoming'}
        </h2>
        {selectedDay && (
          <button
            onClick={() => setSelectedDay(null)}
            className="text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300"
          >
            Show all
          </button>
        )}
      </div>

      {groups.length > 0 ? (
        <motion.div
          key={selectedDay ? selectedDay.toISOString() : 'all'}
          variants={container}
          initial="hidden"
          animate="show"
          className="mt-4 space-y-8"
        >
          {groups.map((group) => (
            <section key={group.date.toISOString()}>
              {/* Per-day sub header only when showing everything (avoids redundancy when filtered). */}
              {!selectedDay && (
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-content-muted">
                    {dayLabel(group.date)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                {group.items.map((m) => (
                  <MeetingCard key={m._id} meeting={m} />
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      ) : (
        <div className="mt-10">
          <EmptyState
            icon={CalendarDays}
            title="No meetings scheduled"
            description={
              selectedDay
                ? `Nothing on ${format(selectedDay, 'EEEE, d MMM')}. Pick another day or schedule one.`
                : 'Your calendar is clear. Schedule a meeting to get started.'
            }
            action={
              <Button onClick={schedule}>
                <Plus size={17} />
                Schedule meeting
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
