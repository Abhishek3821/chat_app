import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, isToday, isYesterday, formatDistanceToNowStrict } from 'date-fns';

/** Merge Tailwind classes conditionally. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * The outer shell every top-level tab uses — one gutter, one width cap, applied
 * identically everywhere.
 *
 * It lives here rather than in each page because that is exactly how the tabs
 * drifted apart: Calls capped at 4xl, Meetings at 6xl, Admin at 7xl, Settings
 * at 5xl, each with its own padding, so the content jumped position and changed
 * width every time you switched tab. Change the gutter here and every screen
 * moves together.
 *
 * Deliberately modest (12px on phones, 16px from `sm`) — enough to keep content
 * off the nav rail and the window edge without stealing width from the lists.
 */
export const PAGE_SHELL = 'mx-auto w-full max-w-screen-2xl p-3 sm:p-4';

/** Parse to a valid Date or null — NEVER lets an invalid date reach date-fns
 *  (which throws "Invalid time value" and would crash a render). */
function safeDate(input) {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short time like 3:04 PM */
export function formatTime(date) {
  const d = safeDate(date);
  return d ? format(d, 'h:mm a') : '';
}

/** Chat-list style relative label. */
export function formatChatTime(date) {
  const d = safeDate(date);
  if (!d) return '';
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd/MM/yy');
}

/** "Today" / "Yesterday" / "12 June 2026" for date separators. */
export function formatDateSeparator(date) {
  const d = safeDate(date);
  if (!d) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMMM yyyy');
}

export function formatLastSeen(date) {
  const d = safeDate(date);
  return d ? `last seen ${formatDistanceToNowStrict(d)} ago` : 'offline';
}

/** Safe "5 min ago" style relative label ('' if the date is missing/invalid). */
export function formatRelative(date) {
  const d = safeDate(date);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '';
}

/** Safe arbitrary-pattern date label. date-fns `format` THROWS on an invalid
 *  date, so never call it with a bare `new Date(value)` in a render path. */
export function formatDate(date, pattern, fallback = '—') {
  const d = safeDate(date);
  return d ? format(d, pattern) : fallback;
}

export function initials(name) {
  // Coerce rather than default-arg: a param default only covers `undefined`, so a
  // null/non-string name from the API would still throw on .split().
  return String(name ?? '')
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function formatDuration(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Responsive column count for a video-tile grid (calls + meeting rooms), tuned
 * across every Tailwind breakpoint (xs default, sm/md/lg/xl) so tiles stay a
 * sensible size whether there are 2 people on a phone or 12 on a monitor.
 * `total` = every visible tile, including your own.
 */
export function videoGridCols(total) {
  if (total <= 1) return 'grid-cols-1';
  if (total === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (total <= 4) return 'grid-cols-2';
  if (total <= 6) return 'grid-cols-2 sm:grid-cols-3';
  if (total <= 9) return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-3';
  if (total <= 12) return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4';
  // Large meetings: keep going on wide monitors instead of stretching 5 columns
  // across an ultrawide (2xl was previously unused anywhere in the app).
  if (total <= 20) return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';
  return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7';
}

/** Deterministic gradient per id/name — used for avatars & accents.
 *
 *  All six live inside the #0C2C47/#2D5652/#97D3CD palette, but they still have
 *  to tell two people apart at a glance, so they're spread across the family:
 *  navy-dominant, navy-blue, blue-teal, and three depths of teal.
 *
 *  CONSTRAINT: these always carry white text (Avatar renders `text-white`, and
 *  group/community covers put white badges on top), and the smallest avatar is
 *  10px — i.e. WCAG small-text territory. So no endpoint may be lighter than
 *  `brand-500` (#427D77), which is 4.75:1 against white. Don't reach for
 *  `brand-300`/`mint-*` here; those wash the initials out. */
const GRADIENTS = [
  'from-brand-700 to-brand-500', // deep teal ramp
  'from-navy-900 to-brand-600', // navy -> teal (darkest)
  'from-cyan-600 to-brand-500', // brighter teal
  'from-violet-600 to-cyan-600', // blue -> teal
  'from-navy-800 to-violet-500', // navy -> dusk blue
  'from-brand-800 to-cyan-500', // teal, mid depth
];
export function gradientFor(seed) {
  const s = String(seed ?? ''); // null/number seeds must not throw on .length
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}
