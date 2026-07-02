import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CheckCheck, Reply, Smile, MoreHorizontal, Star, Copy, Trash2, Pin } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { formatTime, cn } from '../../lib/utils';
import { mediaUrl } from '../../lib/api';

const QUICK = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

function Ticks({ status }) {
  if (status === 'failed') return <span title="Failed to send" className="text-[11px] font-bold text-rose-300">!</span>;
  if (status === 'read') return <CheckCheck size={14} className="text-cyan-300" />; // coloured — read
  if (status === 'delivered') return <CheckCheck size={14} className="text-white/70" />; // grey — delivered
  return <Check size={14} className="text-white/70" />; // single — sent
}

export default function MessageBubble({ message, isMine, showAvatar, isGroup, status, onReact, onReply }) {
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

          {message.type === 'voice' && <VoiceBubble mine={isMine} duration={message.attachments?.[0]?.duration || 8} />}
          {message.type === 'image' && message.attachments?.[0] && (
            <img src={mediaUrl(message.attachments[0].url)} alt="" className="mb-1 max-h-64 rounded-xl object-cover" />
          )}

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
                    {[
                      { icon: Star, label: 'Star' },
                      { icon: Pin, label: 'Pin' },
                      { icon: Copy, label: 'Copy' },
                      { icon: Trash2, label: 'Delete', danger: true },
                    ].map(({ icon: Icon, label, danger }) => (
                      <button key={label} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-content/5', danger ? 'text-red-500' : 'text-content')}>
                        <Icon size={15} /> {label}
                      </button>
                    ))}
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

function VoiceBubble({ mine, duration }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={cn('grid h-8 w-8 place-items-center rounded-full', mine ? 'bg-white/20' : 'bg-brand-500/15')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={mine ? 'text-white' : 'text-brand-500'}><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      </span>
      <div className="flex items-end gap-0.5">
        {[6, 12, 8, 16, 10, 14, 7, 12, 9, 5].map((h, i) => (
          <span key={i} className={cn('w-0.5 rounded-full', mine ? 'bg-white/60' : 'bg-brand-500/50')} style={{ height: h }} />
        ))}
      </div>
      <span className={cn('text-[11px]', mine ? 'text-white/80' : 'text-content-muted')}>0:{String(duration).padStart(2, '0')}</span>
    </div>
  );
}
