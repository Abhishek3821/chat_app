import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, isToday, isYesterday, formatDistanceToNowStrict } from 'date-fns';

/** Merge Tailwind classes conditionally. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Short time like 3:04 PM */
export function formatTime(date) {
  if (!date) return '';
  return format(new Date(date), 'h:mm a');
}

/** Chat-list style relative label. */
export function formatChatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd/MM/yy');
}

/** "Today" / "Yesterday" / "12 June 2026" for date separators. */
export function formatDateSeparator(date) {
  const d = new Date(date);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMMM yyyy');
}

export function formatLastSeen(date) {
  if (!date) return 'offline';
  return `last seen ${formatDistanceToNowStrict(new Date(date))} ago`;
}

export function initials(name = '') {
  return name
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

/** Deterministic gradient per id/name — used for avatars & accents. */
const GRADIENTS = [
  'from-brand-500 to-violet-500',
  'from-cyan-500 to-brand-500',
  'from-violet-500 to-pink-500',
  'from-emerald-500 to-cyan-500',
  'from-amber-500 to-pink-500',
  'from-brand-600 to-cyan-500',
];
export function gradientFor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}
