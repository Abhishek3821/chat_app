import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pin, X, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { lastMessagePreview } from '../../lib/chat';

/**
 * The pinned-message strip above the conversation.
 *
 * Pinning previously had NO visible effect anywhere — the menu label flipped
 * from "Pin" to "Unpin" and that was the whole feature. This is what a pin is
 * actually for: it sits above the thread until it expires, tells you how long
 * that is, and taps through to the message.
 *
 * With more than one pin, tapping the strip cycles through them (WhatsApp does
 * the same) rather than stacking three banners over the conversation.
 */

/** "58m left" / "5h 12m left" / "23h left" — the unit people care about. */
function remainingLabel(expiresAt, now) {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expiring…';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m left`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 6 && rem) return `${hours}h ${rem}m left`;
  return `${hours}h left`;
}

export default function PinnedBanner({ pins, canPin, meId, onJump, onUnpin }) {
  const [index, setIndex] = useState(0);
  // One shared clock for every countdown, ticking per minute rather than per
  // second: the labels are minute-resolution, so a 1s interval would re-render
  // the strip 60× for nothing.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Keep the cursor in range as pins expire or get removed under it.
  useEffect(() => {
    if (index >= pins.length) setIndex(0);
  }, [pins.length, index]);

  const active = pins[Math.min(index, pins.length - 1)];
  const mine = active && String(active.pinnedBy) === String(meId);
  // Whoever pinned it can always remove it; admins can remove anyone's — the
  // server enforces this, so the button just mirrors the rule.
  const mayUnpin = Boolean(active) && (mine || canPin);

  const preview = useMemo(() => {
    if (!active?.message) return 'Pinned message';
    return active.message.content?.trim() || lastMessagePreview({ lastMessage: active.message }) || 'Attachment';
  }, [active]);

  if (!pins.length || !active) return null;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key="pinned-banner"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="neu-inset-sm shrink-0 overflow-hidden border-b border-border bg-surface-2"
      >
        <div className="flex items-center gap-2.5 px-3 py-2 sm:px-4">
          {/* Vertical ticks: which of the pins you're looking at. */}
          {pins.length > 1 && (
            <div className="flex shrink-0 flex-col gap-0.5" aria-hidden>
              {pins.map((p, i) => (
                <span
                  key={p.messageId}
                  className={cn('h-1.5 w-0.5 rounded-full', i === index ? 'bg-brand-500' : 'bg-content/20')}
                />
              ))}
            </div>
          )}

          <Pin size={14} className="shrink-0 -rotate-45 text-brand-500" />

          <button
            onClick={() => onJump(active.messageId)}
            className="min-w-0 flex-1 text-left"
            title="Go to the pinned message"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-content-muted">
              <span className="truncate">
                Pinned{active.message?.sender?.name ? ` · ${active.message.sender.name}` : ''}
              </span>
              <span className="neu-raised-sm shrink-0 rounded-full bg-surface px-1.5 py-px text-[10px] font-bold tabular-nums">
                {remainingLabel(active.expiresAt, now)}
              </span>
            </p>
            <p className="truncate text-sm text-content">{preview}</p>
          </button>

          {pins.length > 1 && (
            <button
              onClick={() => setIndex((i) => (i + 1) % pins.length)}
              aria-label="Next pinned message"
              title="Next pinned message"
              className="neu-raised-sm neu-press ring-brand grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-content-muted hover:text-content"
            >
              <ChevronDown size={16} />
            </button>
          )}

          {mayUnpin && (
            <button
              onClick={() => onUnpin(active.messageId)}
              aria-label="Unpin this message"
              title="Unpin"
              className="neu-raised-sm neu-press ring-brand grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-content-muted hover:text-content"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
