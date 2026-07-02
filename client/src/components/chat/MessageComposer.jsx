import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Plus, Smile, Mic, SendHorizontal, X, Image, FileText, MapPin, Camera, Reply } from 'lucide-react';
import { useUI } from '../../store/useUI';
import { emitSocket } from '../../hooks/useSocket';
import { cn } from '../../lib/utils';

const ATTACHMENTS = [
  { icon: Image, label: 'Photo', color: 'text-violet-500 bg-violet-500/10' },
  { icon: Camera, label: 'Camera', color: 'text-brand-500 bg-brand-500/10' },
  { icon: FileText, label: 'Document', color: 'text-cyan-500 bg-cyan-500/10' },
  { icon: MapPin, label: 'Location', color: 'text-emerald-500 bg-emerald-500/10' },
];

export default function MessageComposer({ chatId, replyTo, onClearReply, onSend }) {
  const theme = useUI((s) => s.theme);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [recording, setRecording] = useState(false);
  const typingTimeout = useRef(null);

  const handleChange = (e) => {
    setText(e.target.value);
    emitSocket('typing-start', { chatId });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitSocket('typing-stop', { chatId }), 1500);
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onSend({ content: value, type: 'text', replyTo });
    setText('');
    setShowEmoji(false);
    onClearReply?.();
    emitSocket('typing-stop', { chatId });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const sendVoice = () => {
    onSend({ content: '', type: 'voice', attachments: [{ duration: 8 }] });
    setRecording(false);
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-surface/60 px-3 py-3 backdrop-blur-xl sm:px-4">
      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-brand-500 bg-content/5 px-3 py-2">
              <Reply size={15} className="text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-500">Replying to {replyTo.sender?.name || 'yourself'}</p>
                <p className="truncate text-xs text-content-muted">{replyTo.content}</p>
              </div>
              <button onClick={onClearReply} className="text-content-muted hover:text-content"><X size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emoji picker */}
      <AnimatePresence>
        {showEmoji && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-full left-3 mb-2 z-30">
            <EmojiPicker theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT} width={320} height={380} onEmojiClick={(e) => setText((t) => t + e.emoji)} lazyLoadEmojis previewConfig={{ showPreview: false }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment menu */}
      <AnimatePresence>
        {showAttach && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowAttach(false)} />
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="glass-strong absolute bottom-full left-3 z-30 mb-2 grid grid-cols-2 gap-2 rounded-2xl p-3 shadow-soft-lg">
              {ATTACHMENTS.map(({ icon: Icon, label, color }) => (
                <button key={label} onClick={() => setShowAttach(false)} className="flex w-28 flex-col items-center gap-1.5 rounded-xl p-3 transition-colors hover:bg-content/5">
                  <span className={cn('grid h-11 w-11 place-items-center rounded-full', color)}><Icon size={20} /></span>
                  <span className="text-xs font-medium text-content">{label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        <button onClick={() => { setShowAttach((v) => !v); setShowEmoji(false); }} className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-content-muted transition-all hover:bg-content/5 hover:text-content', showAttach && 'rotate-45 bg-brand-500/10 text-brand-500')}>
          <Plus size={22} />
        </button>

        <div className="flex flex-1 items-end gap-1 rounded-2xl border border-border bg-surface-2 px-2 py-1">
          <button onClick={() => { setShowEmoji((v) => !v); setShowAttach(false); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted hover:text-brand-500">
            <Smile size={21} />
          </button>
          <textarea
            value={text}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type a message…"
            className="scrollbar-thin max-h-32 flex-1 resize-none bg-transparent py-2.5 text-sm text-content outline-none placeholder:text-content-muted"
          />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {text.trim() ? (
            <motion.button
              key="send"
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              whileTap={{ scale: 0.9 }}
              onClick={send}
              className="btn-gradient grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
            >
              <SendHorizontal size={20} />
            </motion.button>
          ) : (
            <motion.button
              key="mic"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              whileTap={{ scale: 0.9 }}
              onMouseDown={() => setRecording(true)}
              onMouseUp={sendVoice}
              onMouseLeave={() => recording && sendVoice()}
              className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors', recording ? 'bg-red-500 text-white' : 'bg-brand-500/10 text-brand-500 hover:bg-brand-500/20')}
            >
              {recording ? (
                <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}><Mic size={20} /></motion.span>
              ) : (
                <Mic size={20} />
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
