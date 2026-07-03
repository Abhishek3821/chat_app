import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Check, CheckCheck, Reply, Smile, MoreHorizontal, Star, Copy, Trash2, Pin, FileText, Download, Play, Pause, MapPin } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { formatTime, formatBytes, formatDuration, cn } from '../../lib/utils';
import { mediaUrl } from '../../lib/api';

const QUICK = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

function Ticks({ status }) {
  if (status === 'failed') return <span title="Failed to send" className="text-[11px] font-bold text-rose-300">!</span>;
  if (status === 'read') return <CheckCheck size={14} className="text-cyan-300" />; // coloured — read
  if (status === 'delivered') return <CheckCheck size={14} className="text-white/70" />; // grey — delivered
  return <Check size={14} className="text-white/70" />; // single — sent
}

export default function MessageBubble({ message, isMine, showAvatar, isGroup, status, onReact, onReply, onStar, onPin, onDelete }) {
  const [showActions, setShowActions] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  if (message.type === 'system') {
    return (
      <div className="my-3 flex justify-center">
        <span className="glass rounded-full px-3.5 py-1.5 text-xs font-medium text-content-muted">{message.content}</span>
      </div>
    );
  }

  const sender = message.sender || {};
  const reactions = message.reactions || [];

  return (
    <div
      className={cn('group flex w-full gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}
      onMouseLeave={() => {
        setShowEmoji(false);
        setShowMenu(false);
      }}
    >
      {!isMine && (
        <div className="w-8 shrink-0 self-end">
          {showAvatar && <Avatar src={sender.avatar} name={sender.name} size="xs" />}
        </div>
      )}

      <div className={cn('relative max-w-[78%] sm:max-w-[65%]', isMine ? 'items-end' : 'items-start')}>
        {/* group sender name */}
        {isGroup && !isMine && showAvatar && (
          <p className="mb-0.5 ml-1 text-xs font-semibold text-brand-500">{sender.name}</p>
        )}

        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onMouseEnter={() => setShowActions(true)}
          className={cn(
            'relative px-3.5 py-2.5 text-sm shadow-soft',
            isMine
              ? 'rounded-[20px] rounded-br-md bg-brand-gradient text-white'
              : 'glass rounded-[20px] rounded-bl-md text-content'
          )}
        >
          {/* reply preview */}
          {message.replyTo && (
            <div className={cn('mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs', isMine ? 'border-white/60 bg-white/15' : 'border-brand-500 bg-content/5')}>
              <p className={cn('font-semibold', isMine ? 'text-white/90' : 'text-brand-500')}>{message.replyTo.sender?.name || 'You'}</p>
              <p className={cn('truncate', isMine ? 'text-white/75' : 'text-content-muted')}>{message.replyTo.content}</p>
            </div>
          )}

          <MessageMedia message={message} isMine={isMine} />

          {message.content && <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>}

          <div className={cn('mt-0.5 flex items-center justify-end gap-1', isMine ? 'text-white/80' : 'text-content-muted')}>
            {message.isEdited && <span className="text-[10px] italic">edited</span>}
            <span className="text-[10px]">{formatTime(message.createdAt)}</span>
            {isMine && <Ticks status={status || message.status} />}
          </div>

          {/* reactions */}
          {reactions.length > 0 && (
            <div className={cn('absolute -bottom-3 flex gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 shadow-soft', isMine ? 'right-2' : 'left-2')}>
              {reactions.slice(0, 3).map((r, i) => (
                <span key={i} className="text-xs">{r.emoji}</span>
              ))}
              {reactions.length > 3 && <span className="text-[10px] text-content-muted">{reactions.length}</span>}
            </div>
          )}
        </motion.div>

        {/* hover action bar */}
        <AnimatePresence>
          {showActions && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn('absolute -top-9 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-soft-lg', isMine ? 'right-0' : 'left-0')}
            >
              <button onClick={() => setShowEmoji((v) => !v)} className="grid h-7 w-7 place-items-center rounded-full text-content-muted hover:bg-content/10 hover:text-content"><Smile size={15} /></button>
              <button onClick={() => onReply?.(message)} className="grid h-7 w-7 place-items-center rounded-full text-content-muted hover:bg-content/10 hover:text-content"><Reply size={15} /></button>
              <button onClick={() => setShowMenu((v) => !v)} className="grid h-7 w-7 place-items-center rounded-full text-content-muted hover:bg-content/10 hover:text-content"><MoreHorizontal size={15} /></button>

              <AnimatePresence>
                {showEmoji && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="absolute -top-11 left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-border bg-surface px-2 py-1.5 shadow-soft-lg">
                    {QUICK.map((e) => (
                      <button key={e} onClick={() => { onReact?.(message._id, e); setShowEmoji(false); }} className="text-lg transition-transform hover:scale-125">{e}</button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showMenu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className={cn('absolute top-9 z-20 w-40 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-soft-lg', isMine ? 'right-0' : 'left-0')}>
                    <MenuItem icon={Star} label={message.starred ? 'Unstar' : 'Star'} onClick={() => { onStar?.(message); setShowMenu(false); }} />
                    <MenuItem icon={Pin} label={message.pinned ? 'Unpin' : 'Pin'} onClick={() => { onPin?.(message); setShowMenu(false); }} />
                    {message.content && (
                      <MenuItem
                        icon={Copy}
                        label="Copy"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(message.content || '');
                            toast.success('Copied');
                          } catch {
                            toast.error('Couldn’t copy');
                          }
                          setShowMenu(false);
                        }}
                      />
                    )}
                    {isMine && <MenuItem icon={Trash2} label="Delete" danger onClick={() => { onDelete?.(message); setShowMenu(false); }} />}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, danger, onClick }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-content/5', danger ? 'text-red-500' : 'text-content')}>
      <Icon size={15} /> {label}
    </button>
  );
}

/** Renders whatever media a message carries (image/video/voice/document/location). */
function MessageMedia({ message, isMine }) {
  const atts = message.attachments || [];

  if (message.type === 'voice' || message.type === 'audio') {
    return <VoiceBubble mine={isMine} url={atts[0]?.url} duration={atts[0]?.duration} />;
  }

  if (message.type === 'location' && message.location) {
    const { lat, lng, label } = message.location;
    return (
      <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer" className={cn('mb-1 flex items-center gap-2 rounded-xl px-3 py-2', isMine ? 'bg-white/15' : 'bg-content/5')}>
        <MapPin size={18} className={isMine ? 'text-white' : 'text-emerald-500'} />
        <span className="text-sm underline">{label || 'Shared location'}</span>
      </a>
    );
  }

  if (message.type === 'document') {
    return atts.map((a, i) => (
      <a key={i} href={mediaUrl(a.url)} target="_blank" rel="noreferrer" download={a.name} className={cn('mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5', isMine ? 'bg-white/15' : 'bg-content/5')}>
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', isMine ? 'bg-white/20' : 'bg-brand-500/15')}>
          <FileText size={18} className={isMine ? 'text-white' : 'text-brand-500'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{a.name || 'Document'}</span>
          <span className={cn('text-[11px]', isMine ? 'text-white/70' : 'text-content-muted')}>{formatBytes(a.size)}</span>
        </span>
        <Download size={16} className={isMine ? 'text-white/80' : 'text-content-muted'} />
      </a>
    ));
  }

  if (message.type === 'video') {
    return atts.map((a, i) => <video key={i} src={mediaUrl(a.url)} controls className="mb-1 max-h-72 w-full rounded-xl" />);
  }

  if (message.type === 'image') {
    if (atts.length <= 1) {
      const a = atts[0];
      return a ? (
        <a href={mediaUrl(a.url)} target="_blank" rel="noreferrer">
          <img src={mediaUrl(a.url)} alt="" className="mb-1 max-h-64 rounded-xl object-cover" loading="lazy" />
        </a>
      ) : null;
    }
    return (
      <div className="mb-1 grid grid-cols-2 gap-1">
        {atts.map((a, i) => (
          <a key={i} href={mediaUrl(a.url)} target="_blank" rel="noreferrer">
            <img src={mediaUrl(a.url)} alt="" className="h-32 w-full rounded-lg object-cover" loading="lazy" />
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
    <div className="flex items-center gap-2 py-1">
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
      <button onClick={toggle} disabled={!src} className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', mine ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-500')}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex items-end gap-0.5">
        {[6, 12, 8, 16, 10, 14, 7, 12, 9, 5].map((h, i) => (
          <span key={i} className={cn('w-0.5 rounded-full', mine ? 'bg-white/60' : 'bg-brand-500/50')} style={{ height: h }} />
        ))}
      </div>
      <span className={cn('text-[11px] tabular-nums', mine ? 'text-white/80' : 'text-content-muted')}>
        {formatDuration((playing || elapsed) ? elapsed : duration || 0)}
      </span>
    </div>
  );
}
