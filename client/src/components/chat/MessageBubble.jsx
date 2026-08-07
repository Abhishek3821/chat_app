import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Check, CheckCheck, Reply, MoreHorizontal, Star, Copy, Trash2, Pin, PinOff, Clock, FileText, Download, Play, Pause, MapPin, Forward, Pencil, Ban, Send, X, Eye, EyeOff, ShoppingBag, ExternalLink, Radio } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { formatTime, formatBytes, formatDuration, cn } from '../../lib/utils';
import { mediaUrl } from '../../lib/api';
import { Rich } from '../../lib/format';
import PollCard from './PollCard';
import { useAuth } from '../../store/useAuth';
import { useChat } from '../../store/useChat';

const QUICK = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
// Kept in step with PIN_DURATIONS in server/utils/pins.js, which validates them.
const PIN_DURATIONS = [1, 6, 12, 24];

/* Action-sheet geometry. Every row is a fixed height so the sheet's total
   height is known BEFORE it mounts — that is what lets it decide to open
   upward when it would otherwise run off the bottom of the window. The old
   dropdown was a plain `absolute top-9` inside the scroller and got clipped by
   `overflow-y-auto` on any message near an edge. */
const SHEET_W = 224;
const SHEET_ROW_H = 40; // .h-10, one per action (the pin row included)
const SHEET_HEAD_H = 57; // quick-reaction row (h-12) + mb-1, divider + mb-1
const SHEET_PAD_Y = 12; // .py-1.5, top + bottom
const SHEET_GAP = 8; // breathing room between the anchor and the sheet
const LONG_PRESS_MS = 420;
const LONG_PRESS_SLOP = 8; // px of finger drift that still counts as a press

/** Recessed well for media / quote blocks. Inside a sent bubble the panel
 *  shadow vars are invisible against the accent fill, so that case gets a
 *  white-on-accent bevel instead. */
function wellClass(isMine) {
  return isMine ? 'neu-on-accent' : 'neu-inset-sm bg-surface-2';
}

function Ticks({ status }) {
  if (status === 'failed') return <span title="Failed to send" className="text-[11px] font-bold text-rose-200">!</span>;
  if (status === 'read') return <CheckCheck size={14} className="text-cyan-200" />; // coloured — read
  if (status === 'delivered') return <CheckCheck size={14} className="text-white/70" />; // grey — delivered
  return <Check size={14} className="text-white/70" />; // single — sent
}

function MessageBubble({
  message,
  isMine,
  showAvatar,
  isGroup,
  status,
  isNew = true,
  // Pin state comes in as props rather than a field on the message: a pinned
  // message is often older than the loaded window, so the pin set is its own
  // slice of the store (see useChat.pinsByChat). Passing primitives keeps this
  // component's memo() effective.
  pinnedUntil,
  canPin = false,
  onReact,
  onReply,
  onStar,
  onPin,
  onUnpin,
  onDelete,
  onForward,
  onEdit,
}) {
  // Viewport position of the open action sheet, or null when closed.
  // Deliberately NOT a "hovered" flag: the previous version set one on
  // mouse-enter and never cleared it, so every bubble you passed over kept a
  // floating toolbar parked on top of the message above it. Revealing the
  // trigger is pure CSS now (see its `group-hover:` classes) and so cannot get
  // stuck in the open state.
  const [sheet, setSheet] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || '');
  const bubbleRef = useRef(null);
  const pressTimer = useRef(null);
  const pressOrigin = useRef(null);

  /* A sheet placed in viewport coordinates goes stale as soon as anything
     moves, so give up and close rather than drift away from its message. */
  useEffect(() => {
    if (!sheet) return undefined;
    const close = () => setSheet(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [sheet]);

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  if (message.type === 'system') {
    return (
      <div className="my-4 flex justify-center">
        <span className="neu-raised-sm rounded-full bg-surface px-3.5 py-1.5 text-xs font-medium text-content-muted">
          {message.content}
        </span>
      </div>
    );
  }

  const sender = message.sender || {};
  const reactions = message.reactions || [];
  const deleted = Boolean(message.isDeleted);
  const forwarded = Boolean(message.forwardedFrom || message.forwarded);
  // Server rejects edits after this window, so don't offer the option past it.
  const EDIT_WINDOW_MS = 5 * 60 * 1000;
  const withinEditWindow = !message.createdAt || Date.now() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;
  const canEdit = isMine && !deleted && withinEditWindow && (message.type === 'text' || !message.type) && message.content;
  // Server rejects "delete for everyone" after this window too — same 5-minute
  // rule as editing. Past it, the sender can still delete the message for
  // themselves, just not retract it from everyone else's chat.
  const DELETE_EVERYONE_WINDOW_MS = 5 * 60 * 1000;
  const withinDeleteWindow = !message.createdAt || Date.now() - new Date(message.createdAt).getTime() <= DELETE_EVERYONE_WINDOW_MS;
  const canDeleteForEveryone = isMine && !deleted && withinDeleteWindow;

  const saveEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== message.content) onEdit?.(message, next);
    else setDraft(message.content || '');
  };

  /* One flat list, built before the sheet renders so its height is known.
     `keepOpen` marks the pin row, which expands in place into its duration
     choices instead of opening a submenu — a submenu would change the sheet's
     height after it had already been positioned. */
  const actions = [
    { icon: Reply, label: 'Reply', run: () => onReply?.(message) },
    { icon: Star, label: message.starred ? 'Unstar' : 'Star', run: () => onStar?.(message) },
    ...(canPin
      ? pinnedUntil
        ? [{ icon: PinOff, label: 'Unpin', run: () => onUnpin?.(message) }]
        : [{ kind: 'pin', icon: Pin, label: 'Pin…', keepOpen: true }]
      : []),
    { icon: Forward, label: 'Forward', run: () => onForward?.(message) },
    ...(message.content
      ? [{
          icon: Copy,
          label: 'Copy',
          run: async () => {
            try {
              await navigator.clipboard.writeText(message.content || '');
              toast.success('Copied');
            } catch {
              toast.error('Couldn’t copy');
            }
          },
        }]
      : []),
    ...(canEdit ? [{ icon: Pencil, label: 'Edit', run: () => { setDraft(message.content || ''); setEditing(true); } }] : []),
    ...(canDeleteForEveryone ? [{ icon: Trash2, label: 'Delete for everyone', danger: true, run: () => onDelete?.(message, 'everyone') }] : []),
    { icon: Trash2, label: 'Delete for me', danger: true, run: () => onDelete?.(message, 'me') },
  ];

  /** Place the sheet against `rect`, flipping above it when there's no room below. */
  const openSheet = (rect) => {
    if (!rect) return;
    const sheetH = SHEET_PAD_Y + SHEET_HEAD_H + actions.length * SHEET_ROW_H;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = rect.bottom + SHEET_GAP;
    const top = below + sheetH + SHEET_GAP <= vh ? below : Math.max(SHEET_GAP, rect.top - sheetH - SHEET_GAP);
    // Sent messages hang their sheet off the right edge, received off the left;
    // both then get clamped inside the viewport.
    const raw = isMine ? rect.right - SHEET_W : rect.left;
    const left = Math.min(Math.max(SHEET_GAP, raw), Math.max(SHEET_GAP, vw - SHEET_W - SHEET_GAP));
    setSheet({ top, left, maxH: vh - SHEET_GAP * 2 });
  };

  const openFromBubble = () => openSheet(bubbleRef.current?.getBoundingClientRect());

  // ── Touch: long-press opens the sheet (there is no hover to lean on) ──
  const cancelPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressOrigin.current = null;
  };
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' || deleted || editing) return;
    // A long press that started on a link, a play button or a video control
    // belongs to that control: opening the sheet here would fire the sheet AND
    // the element's own click on release (e.g. following a location link).
    if (e.target.closest?.('a,button,input,textarea,video,audio')) return;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      openFromBubble();
    }, LONG_PRESS_MS);
  };
  // A press that turns into a scroll is not a long press.
  const onPointerMove = (e) => {
    const o = pressOrigin.current;
    if (!o) return;
    if (Math.abs(e.clientX - o.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - o.y) > LONG_PRESS_SLOP) cancelPress();
  };

  return (
    <div className={cn('group flex w-full gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
      {!isMine && (
        <div className="w-8 shrink-0 self-end">
          {showAvatar && <Avatar src={sender.avatar} name={sender.name} size="xs" />}
        </div>
      )}

      {/* Percentage alone let a bubble run the full width of a wide monitor
          (65% of a ~1900px conversation column ≈ 1200px of text on one line).
          From lg up a rem ceiling caps the measure at a readable ~90 chars. */}
      <div className={cn('relative min-w-0 max-w-[78%] sm:max-w-[70%] md:max-w-[66%] lg:max-w-[min(64%,34rem)] xl:max-w-[min(60%,38rem)] 2xl:max-w-[min(58%,42rem)]', isMine ? 'items-end' : 'items-start')}>
        {/* group sender name */}
        {isGroup && !isMine && showAvatar && (
          <p className="mb-1 ml-1.5 truncate text-xs font-semibold text-brand-600 dark:text-brand-300">{sender.name}</p>
        )}

        <motion.div
          ref={bubbleRef}
          // `initial={false}` skips the mount animation entirely (renders
          // straight at the `animate` values) for bubbles that were already
          // part of the chat's history when it opened — only a genuinely new
          // arrival plays the spring-in. Avoids every bubble in a long chat
          // animating at once, a CPU burst right when the chat is opening.
          initial={isNew ? { opacity: 0, y: 8, scale: 0.98 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onContextMenu={(e) => {
            if (deleted || editing) return;
            e.preventDefault();
            openFromBubble();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          className={cn(
            'relative min-w-0 break-words px-3.5 py-2.5 text-sm',
            isMine
              ? 'rounded-[22px] rounded-br-lg bg-brand-gradient text-white shadow-glow-lg'
              : 'neu-raised rounded-[22px] rounded-bl-lg bg-surface text-content'
          )}
        >
          {deleted ? (
            <p className={cn('flex items-center gap-1.5 py-0.5 text-sm italic', isMine ? 'text-white/70' : 'text-content-muted')}>
              <Ban size={14} /> This message was deleted
            </p>
          ) : editing ? (
            <div className="flex items-end gap-1.5 py-0.5">
              <textarea
                autoFocus
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                  if (e.key === 'Escape') { setEditing(false); setDraft(message.content || ''); }
                }}
                // 140px min blew past a 320px-phone bubble once the two action
                // buttons were subtracted; 5rem still leaves a usable field.
                className={cn('min-w-[5rem] flex-1 resize-none rounded-xl px-2.5 py-1.5 text-sm outline-none', isMine ? 'neu-on-accent text-white placeholder:text-white/50' : 'neu-inset-sm bg-surface-2 text-content')}
              />
              <button onClick={() => { setEditing(false); setDraft(message.content || ''); }} className={cn('neu-press grid h-8 w-8 shrink-0 place-items-center rounded-full', isMine ? 'neu-on-accent text-white' : 'neu-raised-sm bg-surface text-content-muted')}><X size={14} /></button>
              <button onClick={saveEdit} className={cn('neu-press grid h-8 w-8 shrink-0 place-items-center rounded-full text-white', isMine ? 'bg-white/25' : 'btn-gradient')}><Send size={14} /></button>
            </div>
          ) : (
            <>
              {/* forwarded label */}
              {forwarded && (
                <p className={cn('mb-1 flex items-center gap-1 text-xs italic', isMine ? 'text-white/70' : 'text-content-muted')}>
                  <Forward size={12} /> Forwarded
                </p>
              )}

              {/* Pinned marker on the message itself, so scrolling past it in the
                  thread shows it's the one the banner is pointing at. */}
              {pinnedUntil && (
                <p className={cn('mb-1 flex items-center gap-1 text-xs font-medium', isMine ? 'text-white/75' : 'text-brand-600 dark:text-brand-300')}>
                  <Pin size={11} className="-rotate-45" /> Pinned
                </p>
              )}

              {/* reply preview */}
              {message.replyTo && (
                <div className={cn('mb-1.5 overflow-hidden rounded-xl border-l-2 px-2.5 py-1.5 text-xs', isMine ? 'border-white/60' : 'border-brand-500', wellClass(isMine))}>
                  <p className={cn('truncate font-semibold', isMine ? 'text-white/90' : 'text-brand-600 dark:text-brand-300')}>{message.replyTo.sender?.name || 'You'}</p>
                  <p className={cn('truncate', isMine ? 'text-white/75' : 'text-content-muted')}>{message.replyTo.content}</p>
                </div>
              )}

              <MessageMedia message={message} isMine={isMine} />

              {message.type === 'poll' && message.poll && <PollCard message={message} mine={isMine} />}

              {message.content && <Rich text={message.content} mine={isMine} />}
            </>
          )}

          <div className={cn('mt-1 flex items-center justify-end gap-1', isMine ? 'text-white/80' : 'text-content-muted')}>
            {message.isEdited && !deleted && <span className="text-[10px] italic">edited</span>}
            <span className="text-[10px] tabular-nums">{formatTime(message.createdAt)}</span>
            {isMine && !deleted && <Ticks status={status || message.status} />}
          </div>
        </motion.div>

        {/* Reactions ride just under the bubble's lower edge, but IN FLOW — the
            old chip was `absolute -bottom-3`, so it covered the top of the next
            message. The small negative margin keeps it looking attached while
            still reserving its own height in the column. */}
        {reactions.length > 0 && <ReactionChips reactions={reactions} isMine={isMine} />}

        {/* Action trigger. Sits in the gutter BESIDE the bubble instead of
            floating above it, so it can never hide a neighbouring message.
            Hover reveal is CSS-only; touch users long-press the bubble, and
            right-click works anywhere on it. */}
        {!deleted && !editing && (
          <div
            className={cn(
              'pointer-events-none absolute top-1/2 hidden -translate-y-1/2 opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 md:block',
              isMine ? 'right-full mr-2' : 'left-full ml-2',
              sheet && 'pointer-events-auto opacity-100'
            )}
          >
            <button
              onClick={(e) => openSheet(e.currentTarget.getBoundingClientRect())}
              aria-label="Message actions"
              className="neu-raised-sm neu-press grid h-8 w-8 place-items-center rounded-full bg-surface text-content-muted hover:text-content"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Rendered into <body> at viewport coordinates: inside the scroller it
          was clipped by `overflow-y-auto` whenever the message sat near an edge. */}
      {sheet &&
        createPortal(
          <ActionSheet
            sheet={sheet}
            actions={actions}
            onClose={() => setSheet(null)}
            onReact={(emoji) => { onReact?.(message._id, emoji); setSheet(null); }}
            onPinFor={(hours) => { onPin?.(message, hours); setSheet(null); }}
          />,
          document.body
        )}
    </div>
  );
}

/** Grouped reaction pill — identical emoji collapse into one chip + a count. */
function ReactionChips({ reactions, isMine }) {
  const chips = [];
  for (const r of reactions) {
    const hit = chips.find((c) => c.emoji === r.emoji);
    if (hit) hit.n += 1;
    else chips.push({ emoji: r.emoji, n: 1 });
  }
  return (
    <div className={cn('relative z-[1] -mt-2 flex', isMine ? 'justify-end pr-3' : 'justify-start pl-3')}>
      <span className="neu-raised-sm flex items-center gap-1.5 rounded-full bg-surface px-2 py-1">
        {chips.slice(0, 4).map((c) => (
          <span key={c.emoji} className="flex items-center gap-0.5 text-xs leading-none">
            {c.emoji}
            {c.n > 1 && <span className="text-[10px] font-semibold tabular-nums text-content-muted">{c.n}</span>}
          </span>
        ))}
        {chips.length > 4 && <span className="text-[10px] font-semibold text-content-muted">+{chips.length - 4}</span>}
      </span>
    </div>
  );
}

/** Quick reactions and every message action, in one popover. */
function ActionSheet({ sheet, actions, onClose, onReact, onPinFor }) {
  const [pinOpen, setPinOpen] = useState(false);

  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        style={{ top: sheet.top, left: sheet.left, width: SHEET_W, maxHeight: sheet.maxH }}
        className="glass-strong scrollbar-thin fixed z-[60] overflow-y-auto rounded-2xl py-1.5"
      >
        <div className="mb-1 flex h-12 items-center justify-around px-1.5">
          {QUICK.map((e) => (
            <button
              key={e}
              onClick={() => onReact(e)}
              className="grid h-9 w-9 place-items-center rounded-full text-lg transition-transform hover:scale-125 active:scale-95"
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mb-1 h-px bg-border" />

        {actions.map((a) =>
          a.kind === 'pin' && pinOpen ? (
            /* The row swaps its own contents rather than opening a submenu, so
               the sheet keeps exactly the height it was positioned for. */
            <div key="pin" className="flex h-10 items-center gap-1 px-3">
              <Clock size={14} className="shrink-0 text-content-muted" />
              {PIN_DURATIONS.map((h) => (
                <button
                  key={h}
                  onClick={() => onPinFor(h)}
                  className="neu-raised-sm neu-press flex-1 rounded-lg bg-surface py-1 text-[11px] font-bold tabular-nums text-content"
                >
                  {h}h
                </button>
              ))}
            </div>
          ) : (
            <button
              key={a.label}
              onClick={() => {
                if (a.kind === 'pin') return setPinOpen(true);
                a.run();
                onClose();
              }}
              className={cn(
                'flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm transition-colors hover:bg-content/5',
                a.danger ? 'text-red-500' : 'text-content'
              )}
            >
              <a.icon size={15} className="shrink-0" /> {a.label}
            </button>
          )
        )}
      </motion.div>
    </>
  );
}

/** Renders whatever media a message carries (image/video/voice/document/location). */
function MessageMedia({ message, isMine }) {
  const atts = message.attachments || [];
  const meId = useAuth((s) => s.user?._id);
  const consumeViewOnce = useChat((s) => s.consumeViewOnce);

  // View-once media: openable exactly once per recipient, then it's gone.
  if (message.viewOnce && (message.type === 'image' || message.type === 'video')) {
    const consumed = isMine || !atts.length || (message.viewedBy || []).some((v) => String(v?._id ?? v) === String(meId));
    if (consumed) {
      return (
        <div className={cn('mb-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-sm italic', wellClass(isMine), isMine ? 'text-white/80' : 'text-content-muted')}>
          <EyeOff size={16} /> {isMine ? 'View-once media' : 'Opened'}
        </div>
      );
    }
    const openOnce = () => {
      const url = mediaUrl(atts[0]?.url);
      if (url) window.open(url, '_blank', 'noopener');
      consumeViewOnce(message.chat?._id || message.chat, message._id);
    };
    return (
      <button onClick={openOnce} className={cn('neu-press mb-1.5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold', isMine ? 'neu-on-accent text-white' : 'neu-raised-sm bg-brand-500/10 text-brand-600 dark:text-brand-300')}>
        <Eye size={16} /> View once · tap to open
      </button>
    );
  }

  if (message.type === 'voice' || message.type === 'audio') {
    return <VoiceBubble mine={isMine} url={atts[0]?.url} duration={atts[0]?.duration} />;
  }

  if (message.type === 'product' && message.product) {
    const p = message.product;
    const Wrapper = p.link ? 'a' : 'div';
    const wrapProps = p.link ? { href: p.link, target: '_blank', rel: 'noreferrer' } : {};
    return (
      /* w-56 alone overflowed the bubble's inner width on a 320px phone */
      <Wrapper {...wrapProps} className={cn('mb-1.5 block w-56 max-w-full overflow-hidden rounded-2xl', wellClass(isMine))}>
        {p.image ? (
          <img src={mediaUrl(p.image)} alt={p.name} className="h-28 w-full object-cover sm:h-32" loading="lazy" />
        ) : (
          <div className={cn('grid h-24 w-full place-items-center', isMine ? 'bg-white/10' : 'bg-brand-500/10')}><ShoppingBag size={26} className={isMine ? 'text-white/80' : 'text-brand-500'} /></div>
        )}
        <div className="p-2.5">
          <p className={cn('truncate text-sm font-semibold', isMine ? 'text-white' : 'text-content')}>{p.name}</p>
          {p.price ? <p className={cn('text-sm font-bold', isMine ? 'text-white' : 'text-brand-600 dark:text-brand-300')}>{p.currency || 'USD'} {p.price}</p> : null}
          {p.description && <p className={cn('mt-0.5 line-clamp-2 text-xs', isMine ? 'text-white/75' : 'text-content-muted')}>{p.description}</p>}
          {p.link && <span className={cn('mt-1 inline-flex items-center gap-1 text-[11px] font-medium', isMine ? 'text-white/80' : 'text-brand-500')}><ExternalLink size={11} /> View</span>}
        </div>
      </Wrapper>
    );
  }

  if (message.type === 'location' && message.location) {
    const { lat, lng, label } = message.location;
    const live = message.liveLocation?.active && (!message.liveLocation.expiresAt || new Date(message.liveLocation.expiresAt) > new Date());
    return (
      <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer" className={cn('mb-1.5 flex items-center gap-2 rounded-xl px-3 py-2.5', wellClass(isMine))}>
        {live ? <Radio size={18} className={cn('shrink-0 animate-pulse', isMine ? 'text-white' : 'text-emerald-500')} /> : <MapPin size={18} className={cn('shrink-0', isMine ? 'text-white' : 'text-emerald-500')} />}
        <span className="min-w-0 break-words text-sm underline">{live ? 'Live location · sharing' : (label || 'Shared location')}</span>
      </a>
    );
  }

  if (message.type === 'document') {
    return atts.map((a, i) => (
      <a key={i} href={mediaUrl(a.url)} target="_blank" rel="noreferrer" download={a.name} className={cn('mb-1.5 flex items-center gap-3 rounded-xl px-3 py-2.5', wellClass(isMine))}>
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', isMine ? 'bg-white/20 shadow-glow' : 'neu-raised-sm bg-brand-500/15')}>
          <FileText size={18} className={isMine ? 'text-white' : 'text-brand-600 dark:text-brand-300'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{a.name || 'Document'}</span>
          <span className={cn('text-[11px]', isMine ? 'text-white/70' : 'text-content-muted')}>{formatBytes(a.size)}</span>
        </span>
        <Download size={16} className={cn('shrink-0', isMine ? 'text-white/80' : 'text-content-muted')} />
      </a>
    ));
  }

  if (message.type === 'video') {
    return atts.map((a, i) => (
      <video key={i} src={mediaUrl(a.url)} controls preload="metadata" className="mb-1.5 max-h-60 w-full rounded-2xl bg-black/80 shadow-soft sm:max-h-72 2xl:max-h-96" />
    ));
  }

  // Video note — round, like Telegram. Sized in rem rather than % so the circle
  // stays a circle (aspect-square + a percentage width would let a narrow bubble
  // squash it), and capped so it can't outgrow the bubble on a 320px screen.
  if (message.type === 'videoNote') {
    return atts.map((a, i) => (
      <div key={i} className="mb-1.5">
        <video
          src={mediaUrl(a.url)}
          controls
          playsInline
          preload="metadata"
          className="aspect-square h-40 w-40 rounded-full bg-black object-cover shadow-soft-lg xs:h-48 xs:w-48 sm:h-56 sm:w-56"
        />
        {a.duration ? <p className="mt-1 text-center text-[11px] opacity-70">{formatDuration(a.duration)}</p> : null}
      </div>
    ));
  }

  if (message.type === 'image') {
    if (atts.length <= 1) {
      const a = atts[0];
      if (!a) return null;
      // Reserve the image's box BEFORE it decodes (CLS fix): a bare `max-h-64`
      // with no width/height/aspect-ratio has no definite size until the image
      // loads, so the whole message list used to jump down on every load.
      // Real dimensions (when the upload reported them) give an exact
      // reservation; otherwise fall back to a sensible default ratio.
      const knownAspect = a.width && a.height ? a.width / a.height : null;
      return (
        /* p-1 leaves a hairline of the recessed well showing around the photo —
           a mount, rather than an image butted against the bubble's fill. */
        <a href={mediaUrl(a.url)} target="_blank" rel="noreferrer" className={cn('mb-1.5 block w-full max-w-[15rem] overflow-hidden rounded-2xl p-1 xs:max-w-xs 2xl:max-w-sm', wellClass(isMine))}>
          <img
            src={mediaUrl(a.url)}
            alt=""
            className={cn('w-full rounded-xl object-cover', !knownAspect && 'aspect-[4/3]')}
            style={knownAspect ? { aspectRatio: knownAspect } : undefined}
            loading="lazy"
          />
        </a>
      );
    }
    return (
      <div className="mb-1.5 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
        {atts.map((a, i) => (
          <a key={i} href={mediaUrl(a.url)} target="_blank" rel="noreferrer" className={cn('overflow-hidden rounded-xl p-1', wellClass(isMine))}>
            <img src={mediaUrl(a.url)} alt="" className="h-24 w-full rounded-lg object-cover xs:h-28 sm:h-32" loading="lazy" />
          </a>
        ))}
      </div>
    );
  }

  return null;
}

/** A real, playable voice-note bubble. */
function VoiceBubble({ mine, url, duration }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const src = url ? mediaUrl(url) : null;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  return (
    <div className="flex min-w-0 items-center gap-2.5 py-1">
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setElapsed(0); }}
          onTimeUpdate={(e) => setElapsed(Math.floor(e.target.currentTime))}
        />
      )}
      <button onClick={toggle} disabled={!src} className={cn('neu-press grid h-10 w-10 shrink-0 place-items-center rounded-full sm:h-9 sm:w-9', mine ? 'bg-white/25 text-white shadow-glow' : 'neu-raised-sm bg-surface text-brand-600 dark:text-brand-300')}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex shrink-0 items-end gap-[3px]">
        {[6, 12, 8, 16, 10, 14, 7, 12, 9, 5].map((h, i) => (
          <span key={i} className={cn('w-[3px] rounded-full', mine ? 'bg-white/70' : 'bg-brand-500/60')} style={{ height: h }} />
        ))}
      </div>
      <span className={cn('shrink-0 text-[11px] tabular-nums', mine ? 'text-white/80' : 'text-content-muted')}>
        {formatDuration((playing || elapsed) ? elapsed : duration || 0)}
      </span>
    </div>
  );
}

// Memoized: bubbles re-render only when their own message (or callbacks) change,
// not on every store tick while a long conversation is open.
export default memo(MessageBubble);
