import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format, isToday, isTomorrow, isSameDay, addDays } from 'date-fns';
import {
  CalendarDays,
  Video,
  Phone,
  Clock,
  Repeat,
  Plus,
  Users,
  Check,
  HelpCircle,
  XCircle,
  Copy,
  LogIn,
  ClipboardList,
} from 'lucide-react';
import toast from 'react-hot-toast';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { useAuth } from '@/store/useAuth';
import { useMeetings } from '@/store/useMeetings';

/** The shareable room code for a meeting (falls back to parsing the link). */
const roomCodeOf = (meeting) => meeting.roomCode || (meeting.link || '').split('/meet/')[1] || '';

/** Human-readable duration from seconds ("45s" / "12m" / "1h 5m"). */
function fmtDuration(sec) {
  const s = Math.round(sec || 0);
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

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

const RSVP_OPTIONS = [
  { value: 'going', label: 'Going', icon: Check, active: 'bg-emerald-500 text-white' },
  { value: 'maybe', label: 'Maybe', icon: HelpCircle, active: 'bg-amber-500 text-white' },
  { value: 'not_going', label: "Can't go", icon: XCircle, active: 'bg-red-500 text-white' },
];

function MeetingCard({ meeting, me }) {
  const rsvp = useMeetings((s) => s.rsvp);
  const getReport = useMeetings((s) => s.getReport);
  const navigate = useNavigate();
  const [savingRsvp, setSavingRsvp] = useState(null); // the response value being saved
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const roomCode = roomCodeOf(meeting);

  const openReport = async () => {
    setReportOpen(true);
    setLoadingReport(true);
    try {
      setReport(await getReport(meeting._id));
    } catch (err) {
      toast.error(err?.message || 'Could not load the report.');
      setReportOpen(false);
    } finally {
      setLoadingReport(false);
    }
  };
  const start = new Date(meeting.startAt);
  const end = new Date(start.getTime() + (meeting.durationMinutes || 30) * 60 * 1000);
  const soon = isToday(start);
  // Real meetings store participants as { user, response }; normalise to user objects.
  const participantUsers = (meeting.participants || []).map((p) => p.user || p).filter(Boolean);
  const people = [meeting.host, ...participantUsers].filter(Boolean);

  const amHost = String(meeting.host?._id) === String(me?._id);
  // My invite entry (if I'm a participant) → drives the RSVP control + its current state.
  const myEntry = (meeting.participants || []).find(
    (p) => String(p.user?._id || p.user) === String(me?._id)
  );
  const myResponse = myEntry?.response;

  const handleRsvp = async (value) => {
    if (savingRsvp) return;
    setSavingRsvp(value);
    try {
      await rsvp(meeting._id, value);
    } catch (err) {
      toast.error(err?.message || 'Could not update your RSVP.');
    } finally {
      setSavingRsvp(null);
    }
  };

  // Join the shareable room (Google-Meet style) — everyone lands in the same room.
  const join = () => {
    if (!roomCode) return toast.error('This meeting has no room link.');
    navigate(`/meet/${roomCode}`);
  };
  const copyLink = () => {
    const url = `${window.location.origin}/meet/${roomCode}`;
    navigator.clipboard?.writeText(url).then(() => toast.success('Meeting link copied — share it with anyone.')).catch(() => toast(url));
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

        {amHost && (
          <Button variant="ghost" size="sm" aria-label="Attendance report" onClick={openReport} className="shrink-0">
            <ClipboardList size={16} /> Report
          </Button>
        )}
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
          {(meeting.participants?.length || 0) + 1}
        </span>
      </div>

      {/* RSVP — only for invitees (the host doesn't RSVP to their own meeting). */}
      {!amHost && myEntry && (
        <div className="relative mt-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">Your response</p>
          <div className="flex gap-2">
            {RSVP_OPTIONS.map(({ value, label, icon: Icon, active }) => {
              const selected = myResponse === value;
              return (
                <button
                  key={value}
                  onClick={() => handleRsvp(value)}
                  disabled={!!savingRsvp}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-60',
                    selected ? `border-transparent ${active}` : 'border-border text-content-muted hover:bg-content/5'
                  )}
                >
                  <Icon size={14} strokeWidth={2.4} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative mt-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ParticipantStack people={people} />
          <p className="min-w-0 truncate text-xs text-content-muted">
            Hosted by <span className="font-semibold text-content">{meeting.host?.name || 'You'}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyLink} title="Copy meeting link"><Copy size={15} /></Button>
          <Button onClick={join}>
            {meeting.type === 'video' ? <Video size={17} /> : <Phone size={17} />}
            Join
          </Button>
        </div>
      </div>

      <MeetingReportModal open={reportOpen} onClose={() => setReportOpen(false)} report={report} loading={loadingReport} />
    </motion.article>
  );
}

function ReportStat({ label, value }) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-3 text-center">
      <p className="truncate text-base font-bold text-content">{value}</p>
      <p className="text-[11px] font-medium text-content-muted">{label}</p>
    </div>
  );
}

function MeetingReportModal({ open, onClose, report, loading }) {
  return (
    <Modal open={open} onClose={onClose} title="Meeting report" subtitle={report?.title} size="lg">
      {loading || !report ? (
        <p className="py-10 text-center text-sm text-content-muted">Loading attendance…</p>
      ) : (
        <div className="space-y-4 pb-2">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <ReportStat label="Date" value={report.startedAt ? format(new Date(report.startedAt), 'd MMM') : '—'} />
            <ReportStat label="Started" value={report.startedAt ? format(new Date(report.startedAt), 'h:mm a') : 'Not yet'} />
            <ReportStat label="Duration" value={report.durationSeconds ? fmtDuration(report.durationSeconds) : report.status === 'ongoing' ? 'Live' : '—'} />
            <ReportStat label="Attended" value={report.attendeeCount} />
          </div>
          {report.timezone && <p className="text-center text-xs text-content-muted">Times shown in your local zone · scheduled for {report.timezone}</p>}

          <div>
            <p className="mb-2 text-sm font-medium text-content">Participants ({report.attendeeCount})</p>
            {report.attendees.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-content-muted">No one has joined this meeting yet.</p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                {report.attendees.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <Avatar name={a.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-content">{a.name || 'Guest'}</p>
                      <p className="truncate text-xs text-content-muted">{a.email || '—'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-content-muted">
                        {a.joinedAt ? format(new Date(a.joinedAt), 'h:mm a') : '—'}
                        {a.leftAt ? ` – ${format(new Date(a.leftAt), 'h:mm a')}` : ''}
                      </p>
                      <p className="text-xs font-semibold text-content">{fmtDuration(a.durationSeconds)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function MeetingsPage() {
  const openModal = useUI((s) => s.openModal);
  const meetings = useMeetings((s) => s.meetings);
  const loadMeetings = useMeetings((s) => s.load);
  const createInstant = useMeetings((s) => s.createInstant);
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [selectedDay, setSelectedDay] = useState(null); // Date | null (null = show all upcoming)
  const [joinCode, setJoinCode] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // Start an instant meeting and drop straight into its room (like Meet's "New meeting").
  const startInstant = async () => {
    setStarting(true);
    try {
      const meeting = await createInstant('video');
      const code = roomCodeOf(meeting);
      if (code) navigate(`/meet/${code}`);
    } catch (err) {
      toast.error(err?.message || 'Could not start the meeting.');
    } finally {
      setStarting(false);
    }
  };

  // Accept a raw code OR a pasted full link.
  const goJoin = (e) => {
    e.preventDefault();
    const code = (joinCode.includes('/meet/') ? joinCode.split('/meet/')[1] : joinCode).trim().replace(/\/+$/, '');
    if (code) navigate(`/meet/${code}`);
  };

  const sorted = useMemo(
    () => [...meetings].sort((a, b) => new Date(a.startAt) - new Date(b.startAt)),
    [meetings]
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

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={schedule}>
            <Plus size={17} />
            <span className="hidden sm:inline">Schedule</span>
          </Button>
          <Button onClick={startInstant} disabled={starting}>
            <Video size={17} />
            <span className="hidden sm:inline">{starting ? 'Starting…' : 'New meeting'}</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </motion.header>

      {/* Join with a code / pasted link (like Google Meet). */}
      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        onSubmit={goJoin}
        className="mt-4 flex items-center gap-2"
      >
        <div className="relative flex-1 sm:max-w-xs">
          <LogIn className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter a code or link"
            className="ring-brand h-10 w-full rounded-xl border border-border bg-surface-2 pl-10 pr-3 text-sm placeholder:text-content-muted"
          />
        </div>
        <Button type="submit" variant="subtle" disabled={!joinCode.trim()}>Join</Button>
      </motion.form>

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
                  <MeetingCard key={m._id} meeting={m} me={me} />
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
