import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format, isToday, isTomorrow, isYesterday, isSameDay, addDays } from 'date-fns';
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
  LayoutGrid,
  List,
  Radio,
  UserPlus,
  Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader, { SegmentedControl } from '@/components/ui/PageHeader';
import { cn, formatDate, PAGE_SHELL } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { useAuth } from '@/store/useAuth';
import { useMeetings } from '@/store/useMeetings';
import { useContacts } from '@/store/useContacts';

/** The shareable room code for a meeting (falls back to parsing the link). */
const roomCodeOf = (meeting) => meeting.roomCode || (meeting.link || '').split('/meet/')[1] || '';

/** When a meeting is over: scheduled start + its duration. */
const endOf = (meeting) =>
  new Date(new Date(meeting.startAt).getTime() + (meeting.durationMinutes || 30) * 60 * 1000);

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
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const cardItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 26 } },
};

/** Human label for a day used as a section header. */
function dayLabel(date) {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, d MMMM');
}

/** Overlapping stack of participant avatars, capped with a "+N". */
function ParticipantStack({ people = [], max = 4, size = 'sm' }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((p) => (
        <div key={p._id} className="rounded-full ring-2 ring-surface">
          <Avatar src={p.avatar} name={p.name} size={size} />
        </div>
      ))}
      {extra > 0 && (
        <div
          className={cn(
            'grid place-items-center rounded-full bg-surface-2 font-semibold text-content-muted ring-2 ring-surface',
            size === 'xs' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
          )}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}

function TypeChip({ type, compact }) {
  const isVideo = type === 'video';
  const Icon = isVideo ? Video : Phone;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full text-[11px] font-semibold',
        compact ? 'px-2 py-0.5' : 'px-2.5 py-1',
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

/** Live / Today / Ended — the one status the row or card leads with. */
function StatusChip({ meeting, past }) {
  const start = new Date(meeting.startAt);
  if (meeting.status === 'ongoing') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
        <Radio size={12} strokeWidth={2.4} className="animate-pulse" />
        Live
      </span>
    );
  }
  if (meeting.status === 'cancelled') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-content/10 px-2.5 py-1 text-[11px] font-semibold text-content-muted">
        Cancelled
      </span>
    );
  }
  if (past) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-content/10 px-2.5 py-1 text-[11px] font-semibold text-content-muted">
        Ended
      </span>
    );
  }
  if (isToday(start)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        Today
      </span>
    );
  }
  return null;
}

const RSVP_OPTIONS = [
  { value: 'going', label: 'Going', icon: Check, active: 'bg-emerald-500 text-white' },
  { value: 'maybe', label: 'Maybe', icon: HelpCircle, active: 'bg-amber-500 text-white' },
  { value: 'not_going', label: "Can't go", icon: XCircle, active: 'bg-red-500 text-white' },
];

/**
 * Everything both layouts need to DO with a meeting (join, copy the link, pull
 * the host-only attendance report). Extracted so the card and the list row stay
 * two presentations of one behaviour rather than two copies of it.
 */
function useMeetingActions(meeting) {
  const getReport = useMeetings((s) => s.getReport);
  const navigate = useNavigate();
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const roomCode = roomCodeOf(meeting);

  const openReport = useCallback(async () => {
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
  }, [getReport, meeting._id]);

  // Join the shareable room (Google-Meet style) — everyone lands in the same room.
  const join = useCallback(() => {
    if (!roomCode) return toast.error('This meeting has no room link.');
    return navigate(`/meet/${roomCode}`);
  }, [roomCode, navigate]);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/meet/${roomCode}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success('Meeting link copied — share it with anyone.'))
      .catch(() => toast(url));
  }, [roomCode]);

  return { roomCode, join, copyLink, openReport, reportOpen, setReportOpen, report, loadingReport };
}

/** My RSVP row — full-width buttons on a card, icon-only on a list row. */
function RsvpButtons({ meeting, myResponse, compact }) {
  const rsvp = useMeetings((s) => s.rsvp);
  const [saving, setSaving] = useState(null);

  const handle = async (value) => {
    if (saving) return;
    setSaving(value);
    try {
      await rsvp(meeting._id, value);
    } catch (err) {
      toast.error(err?.message || 'Could not update your RSVP.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={cn('flex gap-2', compact ? 'shrink-0' : 'w-full')}>
      {RSVP_OPTIONS.map(({ value, label, icon: Icon, active }) => {
        const selected = myResponse === value;
        return (
          <button
            key={value}
            onClick={(e) => {
              e.stopPropagation();
              handle(value);
            }}
            disabled={!!saving}
            title={label}
            aria-label={label}
            aria-pressed={selected}
            className={cn(
              'ring-brand inline-flex items-center justify-center gap-1.5 rounded-xl border font-semibold transition-colors disabled:opacity-60',
              // min-w-0 + tight base padding: three labels ("Going/Maybe/Can't go")
              // plus icons sit right on the limit inside a 320px-wide card.
              compact ? 'h-8 w-8' : 'min-w-0 flex-1 px-1.5 py-2.5 text-xs xs:px-2',
              selected ? `border-transparent ${active}` : 'border-border text-content-muted hover:bg-content/5'
            )}
          >
            <Icon size={14} strokeWidth={2.4} />
            {!compact && label}
          </button>
        );
      })}
    </div>
  );
}

/** Who am I to this meeting — host, invitee (with my response), or neither. */
function useMyRole(meeting, me) {
  const amHost = String(meeting.host?._id) === String(me?._id);
  const myEntry = (meeting.participants || []).find(
    (p) => String(p.user?._id || p.user) === String(me?._id)
  );
  return { amHost, myEntry, myResponse: myEntry?.response };
}

/* ─────────────────────────────────────────────────────────────
   Grid layout — the roomy card
   ───────────────────────────────────────────────────────────── */
function MeetingCard({ meeting, me, past }) {
  const { roomCode, join, copyLink, openReport, reportOpen, setReportOpen, report, loadingReport } =
    useMeetingActions(meeting);
  const { amHost, myEntry, myResponse } = useMyRole(meeting, me);
  const [inviteOpen, setInviteOpen] = useState(false);

  const start = new Date(meeting.startAt);
  const end = endOf(meeting);
  const participantUsers = (meeting.participants || []).map((p) => p.user || p).filter(Boolean);
  const people = [meeting.host, ...participantUsers].filter(Boolean);

  return (
    <motion.article
      variants={cardItem}
      whileHover={{ scale: 1.01, y: -2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={cn(
        'glass-strong relative flex flex-col overflow-hidden rounded-3xl p-4 shadow-soft sm:p-5',
        past && 'opacity-90'
      )}
    >
      {/* Ambient accent wash */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-gradient opacity-10 blur-2xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip type={meeting.type} />
          <StatusChip meeting={meeting} past={past} />
          {meeting.recurrence !== 'none' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold capitalize text-violet-600 dark:text-violet-300">
              <Repeat size={12} strokeWidth={2.4} />
              {meeting.recurrence}
            </span>
          )}
        </div>

        {amHost && (
          <button
            aria-label="Attendance report"
            onClick={openReport}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full neu-raised-sm neu-press bg-surface px-3 py-1.5 text-xs font-semibold text-content-muted hover:text-brand-600 dark:hover:text-brand-300"
          >
            <ClipboardList size={14} /> Report
          </button>
        )}
      </div>

      {/* break-words: a pasted URL as the title would otherwise widen the card. */}
      <h3 className="relative mt-3 break-words text-lg font-bold leading-snug text-content">{meeting.title}</h3>
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

      {/* RSVP — only for invitees, and only while the meeting is still ahead. */}
      {!amHost && myEntry && !past && (
        <div className="relative mt-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">Your response</p>
          <RsvpButtons meeting={meeting} myResponse={myResponse} />
        </div>
      )}

      {/* mt-auto pins the action row to the bottom, so cards of different text
          lengths in the same grid row line their buttons up. flex-wrap: the
          avatar stack + host line + Join exceed a 320px card on one line. */}
      <div className="relative mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-3 pt-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ParticipantStack people={people} />
          <p className="min-w-0 truncate text-xs text-content-muted">
            Hosted by <span className="font-semibold text-content">{meeting.host?.name || 'You'}</span>
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {roomCode && (
            <button
              onClick={copyLink}
              title="Copy meeting link"
              className="hidden items-center gap-1.5 rounded-xl neu-raised-sm neu-press bg-surface px-2.5 py-2 font-mono text-[11px] font-semibold text-content-muted hover:text-content sm:inline-flex"
            >
              {roomCode}
              <Copy size={12} />
            </button>
          )}
          <Button variant="outline" size="sm" onClick={copyLink} title="Copy meeting link" className="sm:hidden"><Copy size={15} /></Button>
          {/* Host-only, and pointless once the meeting has ended. */}
          {amHost && !past && (
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)} title="Invite people">
              <UserPlus size={15} /> <span className="hidden sm:inline">Invite</span>
            </Button>
          )}
          <Button onClick={join} variant={past ? 'outline' : 'primary'}>
            {meeting.type === 'video' ? <Video size={17} /> : <Phone size={17} />}
            {past ? 'Reopen' : 'Join'}
          </Button>
        </div>
      </div>

      {/* Host-only, and only mounted once opened — a list of 50 meetings should
          not portal 50 dormant dialogs into <body>. */}
      {amHost && reportOpen && (
        <MeetingReportModal open onClose={() => setReportOpen(false)} report={report} loading={loadingReport} />
      )}
      {/* Same reasoning as the report dialog: mounted only once opened, so a page
          of 50 meetings does not portal 50 dormant modals into <body>. */}
      {amHost && inviteOpen && (
        <InvitePeopleModal open onClose={() => setInviteOpen(false)} meeting={meeting} />
      )}
    </motion.article>
  );
}

/* ─────────────────────────────────────────────────────────────
   List layout — one dense row per meeting
   ───────────────────────────────────────────────────────────── */
function MeetingListRow({ meeting, me, past }) {
  const { roomCode, join, copyLink, openReport, reportOpen, setReportOpen, report, loadingReport } =
    useMeetingActions(meeting);
  const { amHost, myEntry, myResponse } = useMyRole(meeting, me);
  const [inviteOpen, setInviteOpen] = useState(false);

  const start = new Date(meeting.startAt);
  const end = endOf(meeting);
  const participantUsers = (meeting.participants || []).map((p) => p.user || p).filter(Boolean);
  const people = [meeting.host, ...participantUsers].filter(Boolean);

  return (
    <motion.article
      variants={cardItem}
      /* Two lines on a phone, one from sm: up. The action rail is `shrink-0` and
         adds up to ~180px, which left the title with ~80px on a 360px screen —
         every meeting read as "S..", and the time span wrapped over three
         lines. On mobile the rail now takes a full-width second line (see
         `basis-full` below) and the title gets the whole first one. */
      className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 transition-colors hover:bg-content/[0.035] sm:flex-nowrap sm:gap-4 sm:px-4"
    >
      {/* Date block — carries the date so the row needs no day header above it. */}
      <div
        className={cn(
          'grid h-14 w-14 shrink-0 place-content-center justify-items-center rounded-2xl border text-center',
          isToday(start) && !past
            ? 'border-transparent bg-brand-gradient text-white shadow-glow'
            : 'border-border bg-surface-2 text-content'
        )}
      >
        <span className={cn('text-[10px] font-bold uppercase tracking-wide', isToday(start) && !past ? 'text-white/80' : 'text-content-muted')}>
          {format(start, 'MMM')}
        </span>
        <span className="text-lg font-bold leading-none">{format(start, 'd')}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-semibold text-content">{meeting.title}</h3>
          <StatusChip meeting={meeting} past={past} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted">
          {/* nowrap on each item: these are single values, and wrapping INSIDE
              one ("Tue · 1:21 / PM – 1:51 / PM") is what made the row three
              lines tall on a phone. They wrap as whole units instead. */}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Clock size={13} className="shrink-0 text-brand-500" />
            {format(start, 'EEE')} · {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Users size={13} className="shrink-0 text-brand-500" />
            {(meeting.participants?.length || 0) + 1}
          </span>
          {meeting.recurrence !== 'none' && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap capitalize">
              <Repeat size={13} className="text-violet-500" />
              {meeting.recurrence}
            </span>
          )}
          <span className="hidden min-w-0 truncate md:inline">
            Hosted by <span className="font-semibold text-content">{meeting.host?.name || 'You'}</span>
          </span>
        </div>

        {/* RSVP sits in the right rail from xl up. Below that the rail has
            already dropped it, so it wraps under the meta line rather than
            disappearing — otherwise the only meeting you could respond to on a
            phone was the single one featured at the top of the page. */}
        {!amHost && myEntry && !past && (
          <div className="mt-2 xl:hidden">
            <RsvpButtons meeting={meeting} myResponse={myResponse} compact />
          </div>
        )}
      </div>

      {/* Right rail — each piece drops out at the width where it stops fitting.
          `basis-full` on mobile: as bare siblings these competed with the title
          for the same line and won (every one of them is shrink-0). Grouped, they
          drop to a line of their own below 640px and sit inline from sm: up. */}
      <div className="flex basis-full items-center justify-end gap-2 sm:basis-auto sm:shrink-0 sm:gap-2.5 md:gap-3">
        <div className="hidden shrink-0 lg:block">
          <ParticipantStack people={people} max={3} size="xs" />
        </div>
        {!amHost && myEntry && !past && (
          <div className="hidden xl:block">
            <RsvpButtons meeting={meeting} myResponse={myResponse} compact />
          </div>
        )}
        {/* Leads the mobile action line (mr-auto) so it fills the space the
            buttons leave, instead of being dropped below md as it used to be. */}
        <div className="mr-auto shrink-0 sm:mr-0">
          <TypeChip type={meeting.type} compact />
        </div>
        {roomCode && (
          <button
            onClick={copyLink}
            title="Copy meeting link"
            className="hidden shrink-0 items-center gap-1.5 rounded-xl neu-raised-sm neu-press bg-surface px-2.5 py-1.5 font-mono text-[11px] font-semibold text-content-muted hover:text-content xl:inline-flex"
          >
            {roomCode}
            <Copy size={12} />
          </button>
        )}
        {/* Was `hidden sm:inline-flex`, which put the attendance report out of
            reach on a phone for every meeting except the featured one. It's an
            icon-only button — there is room for it at any width. */}
        {amHost && (
          <Button variant="ghost" size="icon-sm" onClick={openReport} title="Attendance report" aria-label="Attendance report" className="inline-flex shrink-0">
            <ClipboardList size={16} />
          </Button>
        )}
        {amHost && !past && (
          <Button variant="ghost" size="icon-sm" onClick={() => setInviteOpen(true)} title="Invite people" aria-label="Invite people" className="shrink-0">
            <UserPlus size={15} />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={copyLink} title="Copy meeting link" aria-label="Copy meeting link" className="shrink-0 xl:hidden">
          <Copy size={16} />
        </Button>
        {/* The label no longer waits for `xs`: the rail has its own line on a
            phone, so an icon-only "Join" was hiding the row's primary action
            behind a guess. */}
        <Button size="sm" onClick={join} variant={past ? 'outline' : 'primary'} className="shrink-0">
          {meeting.type === 'video' ? <Video size={15} /> : <Phone size={15} />}
          {past ? 'Reopen' : 'Join'}
        </Button>
      </div>

      {/* Host-only, and only mounted once opened — a list of 50 meetings should
          not portal 50 dormant dialogs into <body>. */}
      {amHost && reportOpen && (
        <MeetingReportModal open onClose={() => setReportOpen(false)} report={report} loading={loadingReport} />
      )}
      {/* Same reasoning as the report dialog: mounted only once opened, so a page
          of 50 meetings does not portal 50 dormant modals into <body>. */}
      {amHost && inviteOpen && (
        <InvitePeopleModal open onClose={() => setInviteOpen(false)} meeting={meeting} />
      )}
    </motion.article>
  );
}

function ReportStat({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-2xl neu-inset bg-surface-2/60 p-3">
      <div className="flex items-center gap-1.5 text-content-muted">
        <Icon size={13} className={accent} />
        <p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 truncate text-lg font-bold text-content">{value}</p>
    </div>
  );
}

/**
 * Invite more people to a meeting that already exists.
 *
 * Two routes in one dialog, because from the host's point of view it is one job:
 *  · a CONTACT becomes a real participant — the meeting lands in their list, they
 *    are notified in-app, and they can RSVP;
 *  · a raw EMAIL only receives the invitation with the join link, because there is
 *    no account to attach a participant record to.
 *
 * Already-invited contacts are shown as such rather than being silently ignored,
 * and the result toast reports what the server actually did — not what was typed.
 */
function InvitePeopleModal({ open, onClose, meeting }) {
  const invite = useMeetings((s) => s.invite);
  const { contacts, load: loadContacts } = useContacts();
  const [picked, setPicked] = useState([]);
  const [emails, setEmails] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      loadContacts();
      setPicked([]);
      setEmails([]);
      setEmailInput('');
    }
  }, [open, loadContacts]);

  // Who is already on the meeting — host included, so they can't be re-invited.
  const alreadyIn = useMemo(() => {
    const ids = (meeting.participants || []).map((p) => String(p.user?._id || p.user));
    ids.push(String(meeting.host?._id || meeting.host));
    return new Set(ids);
  }, [meeting]);

  const addEmail = () => {
    const e = emailInput.trim().toLowerCase();
    if (!e) return;
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      toast.error('That doesn’t look like an email address.');
      return;
    }
    if (!emails.includes(e)) setEmails((list) => [...list, e]);
    setEmailInput('');
  };

  const submit = async () => {
    /* Include an address still sitting in the input. Typing one and pressing
       "Send invites" without first hitting Enter used to drop it silently, which
       reads as invite-by-email being broken. */
    const pending = emailInput.trim().toLowerCase();
    const allEmails = pending && /^\S+@\S+\.\S+$/.test(pending) && !emails.includes(pending) ? [...emails, pending] : emails;
    if (pending && !/^\S+@\S+\.\S+$/.test(pending)) {
      toast.error('Fix or clear the email address first.');
      return;
    }
    if (!picked.length && !allEmails.length) {
      toast.error('Pick a contact or enter an email address.');
      return;
    }
    setBusy(true);
    try {
      const { added, alreadyInvited, unreachable, invitesQueued } = await invite(meeting._id, {
        userIds: picked,
        emails: allEmails,
      });
      /* Report what the SERVER did, not what was selected — and distinguish the
         two reasons someone was skipped, because they mean different things to
         the host: already-invited is fine, unreachable is not. */
      const parts = [];
      if (added.length) parts.push(`${added.length} added`);
      if (invitesQueued) parts.push(`${invitesQueued} ${invitesQueued === 1 ? 'email' : 'emails'} sent`);
      if (alreadyInvited) parts.push(`${alreadyInvited} already invited`);
      if (unreachable) parts.push(`${unreachable} could not be reached`);
      toast.success(parts.length ? `Invited — ${parts.join(', ')}` : 'Nothing new to invite');
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not send the invitations.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite people"
      subtitle={meeting.title}
      footer={
        <Button className="w-full" onClick={submit} disabled={busy}>
          <UserPlus size={16} /> {busy ? 'Sending…' : 'Send invites'}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content">
            <Mail size={15} /> Invite by email
          </p>
          <p className="mb-2 text-xs text-content-muted">
            They don’t need an account — the invitation carries the join link.
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="name@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEmail();
                }
              }}
            />
            <Button type="button" variant="subtle" size="md" onClick={addEmail}>
              <Plus size={16} />
            </Button>
          </div>
          {emails.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {emails.map((e) => (
                <span
                  key={e}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 py-1 pl-2.5 pr-1.5 text-xs text-brand-600 dark:text-brand-300"
                >
                  {e}
                  <button
                    onClick={() => setEmails((list) => list.filter((x) => x !== e))}
                    className="grid h-4 w-4 place-items-center rounded-full hover:bg-brand-500/20"
                    aria-label={`Remove ${e}`}
                  >
                    <XCircle size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-content">
            Invite contacts <span className="text-content-muted">({picked.length})</span>
          </p>
          <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
            {contacts.length === 0 && (
              <p className="py-4 text-center text-xs text-content-muted">No contacts yet — invite by email instead.</p>
            )}
            {contacts.map((u) => {
              const on = alreadyIn.has(String(u._id));
              return (
                <button
                  key={u._id}
                  disabled={on}
                  onClick={() => toggle(u._id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                    on ? 'cursor-not-allowed opacity-50' : 'hover:bg-content/5'
                  )}
                >
                  <Avatar src={u.avatar} name={u.name} size="md" online={u.isOnline} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-content">{u.name}</p>
                    <p className="truncate text-xs text-content-muted">
                      {on ? 'Already invited' : `@${u.username}`}
                    </p>
                  </div>
                  {!on && (
                    <span
                      className={cn(
                        'grid h-6 w-6 place-items-center rounded-full border-2 transition-colors',
                        picked.includes(u._id) ? 'border-brand-500 bg-brand-gradient text-white' : 'border-border'
                      )}
                    >
                      {picked.includes(u._id) && <Check size={14} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function MeetingReportModal({ open, onClose, report, loading }) {
  const isLive = report?.status === 'ongoing';
  // Longest presence anchors the attendance bars (falls back to meeting duration).
  const maxSec = Math.max(
    report?.durationSeconds || 0,
    ...(report?.attendees || []).map((a) => a.durationSeconds || 0),
    1
  );

  return (
    <Modal open={open} onClose={onClose} title="Meeting report" subtitle={report?.title} size="lg">
      {loading || !report ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-content-muted">Loading attendance…</p>
        </div>
      ) : (
        <div className="space-y-5 pb-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <ReportStat
              icon={CalendarDays}
              accent="text-brand-500"
              label="Date"
              value={formatDate(report.startedAt, 'd MMM')}
            />
            <ReportStat
              icon={Clock}
              accent="text-brand-500"
              label="Started"
              value={formatDate(report.startedAt, 'h:mm a', 'Not yet')}
            />
            <ReportStat
              icon={Video}
              accent={isLive ? 'text-emerald-500' : 'text-brand-500'}
              label="Duration"
              value={report.durationSeconds ? fmtDuration(report.durationSeconds) : isLive ? 'Live' : '—'}
            />
            <ReportStat icon={Users} accent="text-brand-500" label="Attended" value={report.attendeeCount} />
          </div>

          {report.timezone && (
            <p className="text-center text-xs text-content-muted">
              Times shown in your local zone · scheduled for {report.timezone}
            </p>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-content">Participants</p>
              <span className="rounded-full bg-brand-500/10 px-2.5 py-0.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
                {report.attendeeCount}
              </span>
            </div>
            {report.attendees.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-content-muted">
                No one has joined this meeting yet.
              </p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-2xl neu-inset bg-surface-2/40">
                {report.attendees.map((a, i) => {
                  const stillIn = a.joinedAt && !a.leftAt;
                  const pct = Math.min(100, Math.round(((a.durationSeconds || 0) / maxSec) * 100));
                  return (
                    <div key={i} className="p-3 sm:p-3.5">
                      <div className="flex items-center gap-2.5 sm:gap-3">
                        <Avatar name={a.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-sm font-semibold text-content">
                            {a.name || 'Guest'}
                            {stillIn && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                In meeting
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-content-muted">{a.email || '—'}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-content-muted">
                            {formatDate(a.joinedAt, 'h:mm a')}
                            {a.leftAt ? ` – ${formatDate(a.leftAt, 'h:mm a', '')}` : ''}
                          </p>
                          <p className="text-sm font-bold text-content">{fmtDuration(a.durationSeconds)}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-content/10">
                        <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */
const VIEW_KEY = 'cc_meetings_view'; // 'grid' | 'list'
const VIEW_OPTIONS = [
  { value: 'grid', icon: LayoutGrid, title: 'Card view' },
  { value: 'list', icon: List, title: 'List view' },
];

export default function MeetingsPage() {
  const openModal = useUI((s) => s.openModal);
  const meetings = useMeetings((s) => s.meetings);
  const loadMeetings = useMeetings((s) => s.load);
  const createInstant = useMeetings((s) => s.createInstant);
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [selectedDay, setSelectedDay] = useState(null); // Date | null (null = the whole tab)
  const [tab, setTab] = useState('upcoming'); // 'upcoming' | 'past' | 'all'
  const [view, setView] = useState(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY)) || 'grid'
  );
  const [joinCode, setJoinCode] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const pickView = (v) => {
    setView(v);
    if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_KEY, v);
  };

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

  // Accept a raw code OR a pasted full link. Room codes are always
  // lowercase-alphanumeric-plus-hyphen (see generateRoomCode server-side) —
  // stripping anything else before it hits navigate() blocks a malicious
  // paste (e.g. a backslash/protocol payload) from being used as an open
  // redirect via useNavigate.
  const goJoin = (e) => {
    e.preventDefault();
    const raw = (joinCode.includes('/meet/') ? joinCode.split('/meet/')[1] : joinCode).trim();
    const code = raw.replace(/[^a-z0-9-]/gi, '');
    if (code) navigate(`/meet/${code}`);
  };

  /* Split past from upcoming. The API returns every meeting you're part of and
     this screen used to label the whole list "Upcoming" — so a meeting that
     finished last week still sat under that heading and counted toward the
     "N upcoming" in the header. A meeting is past once its scheduled end has
     gone by (or the host marked it completed/cancelled), unless it's live. */
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const isPast = (m) =>
      m.status !== 'ongoing' &&
      (m.status === 'completed' || m.status === 'cancelled' || endOf(m).getTime() < now);
    const up = [];
    const done = [];
    for (const m of meetings) (isPast(m) ? done : up).push(m);
    // Upcoming reads soonest-first; past reads most-recent-first.
    up.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    done.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    return { upcoming: up, past: done };
  }, [meetings]);

  const isPastMeeting = useCallback((m) => past.includes(m), [past]);

  const tabbed = tab === 'past' ? past : tab === 'all' ? [...upcoming, ...past] : upcoming;

  // The next 7 days for the calendar strip.
  const week = useMemo(() => {
    const base = new Date();
    return Array.from({ length: 7 }, (_, i) => addDays(base, i));
  }, []);

  const hasMeetingOn = (day) => meetings.some((m) => isSameDay(new Date(m.startAt), day));

  const visible = useMemo(() => {
    if (!selectedDay) return tabbed;
    return tabbed.filter((m) => isSameDay(new Date(m.startAt), selectedDay));
  }, [tabbed, selectedDay]);

  // Group visible meetings by day for the card view's section headers.
  const groups = useMemo(() => {
    const map = new Map();
    for (const m of visible) {
      const key = formatDate(m.startAt, 'yyyy-MM-dd', '');
      if (!key) continue; // unparseable startAt must not throw out of the render
      if (!map.has(key)) map.set(key, { date: new Date(m.startAt), items: [] });
      map.get(key).items.push(m);
    }
    return [...map.values()];
  }, [visible]);

  // Picking a day from the strip means "show me this day" — widen to All so a
  // day that holds only finished meetings isn't silently empty under Upcoming.
  const pickDay = (day) => {
    setSelectedDay((prev) => {
      const next = prev && isSameDay(prev, day) ? null : day;
      if (next) setTab('all');
      return next;
    });
  };

  const schedule = () => openModal('scheduleMeeting');

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        icon={CalendarDays}
        title="Meetings"
        subtitle={`${upcoming.length} upcoming · ${past.length} past`}
        actions={
          <>
            <Button variant="outline" onClick={schedule}>
              <Plus size={17} />
              <span className="hidden sm:inline">Schedule</span>
            </Button>
            <Button onClick={startInstant} disabled={starting}>
              <Video size={17} />
              <span className="hidden sm:inline">{starting ? 'Starting…' : 'New meeting'}</span>
              <span className="sm:hidden">New</span>
            </Button>
          </>
        }
      />

      {/* Join with a code / pasted link (like Google Meet). */}
      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        onSubmit={goJoin}
        className="mt-4 flex items-center gap-2"
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <LogIn className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter a code or link"
            className="ring-brand h-10 w-full rounded-xl neu-inset bg-surface-2 pl-10 pr-3 text-sm placeholder:text-content-muted"
          />
        </div>
        <Button type="submit" variant="subtle" disabled={!joinCode.trim()} className="shrink-0">Join</Button>
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
              onClick={() => pickDay(day)}
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

      {/* Tabs + view switch */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelectedDay(null);
          }}
          options={[
            { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
            { value: 'past', label: 'Past', count: past.length },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="flex items-center gap-3">
          {selectedDay && (
            <button
              onClick={() => setSelectedDay(null)}
              className="text-xs font-semibold text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300"
            >
              Clear {dayLabel(selectedDay)}
            </button>
          )}
          <SegmentedControl value={view} onChange={pickView} options={VIEW_OPTIONS} size="sm" />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={CalendarDays}
            title={
              selectedDay
                ? `Nothing on ${format(selectedDay, 'EEEE, d MMM')}`
                : tab === 'past'
                  ? 'No past meetings'
                  : 'No meetings scheduled'
            }
            description={
              selectedDay
                ? 'Pick another day, or schedule something for this one.'
                : tab === 'past'
                  ? 'Meetings move here once they finish.'
                  : 'Your calendar is clear. Schedule a meeting to get started.'
            }
            action={
              tab !== 'past' && (
                <Button onClick={schedule}>
                  <Plus size={17} />
                  Schedule meeting
                </Button>
              )
            }
          />
        </div>
      ) : view === 'list' ? (
        /* ── List view — one flat, dense table-like list. Each row carries its
              own date block, so it needs no per-day headers. ── */
        <motion.div
          key={`list-${tab}-${selectedDay ? selectedDay.toISOString() : 'all'}`}
          variants={container}
          initial="hidden"
          animate="show"
          className="card mt-4 divide-y divide-border overflow-hidden shadow-soft"
        >
          {visible.map((m) => (
            <MeetingListRow key={m._id} meeting={m} me={me} past={isPastMeeting(m)} />
          ))}
        </motion.div>
      ) : (
        /* ── Card view — grouped under day headers. ── */
        <motion.div
          key={`grid-${tab}-${selectedDay ? selectedDay.toISOString() : 'all'}`}
          variants={container}
          initial="hidden"
          animate="show"
          className="mt-4 space-y-8"
        >
          {groups.map((group) => (
            <section key={group.date.toISOString()}>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-content-muted">
                  {dayLabel(group.date)}
                </span>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-semibold tabular-nums text-content-muted/70">
                  {group.items.length}
                </span>
              </div>
              {/* 3-up at 2xl keeps the columns the same ~470px they are at lg,
                  instead of leaving a third of the monitor empty. */}
              <div className="grid items-stretch gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {group.items.map((m) => (
                  <MeetingCard key={m._id} meeting={m} me={me} past={isPastMeeting(m)} />
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      )}
    </div>
  );
}
