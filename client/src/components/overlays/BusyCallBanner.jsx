import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Video, X } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { useUI } from '../../store/useUI';

/**
 * Side notification shown when someone calls while you're already on another
 * call or in a meeting. The caller has been answered with "busy on another
 * call" automatically — this simply tells you who tried to reach you.
 */
export default function BusyCallBanner() {
  const busyIncoming = useUI((s) => s.busyIncoming);
  const dismiss = useUI((s) => s.dismissBusyIncoming);

  // Auto-dismiss after 10s.
  useEffect(() => {
    if (!busyIncoming) return undefined;
    const t = setTimeout(dismiss, 10000);
    return () => clearTimeout(t);
  }, [busyIncoming, dismiss]);

  return (
    <AnimatePresence>
      {busyIncoming && (
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          className="fixed right-4 top-4 z-[130] flex w-[min(92vw,20rem)] items-start gap-3 rounded-2xl bg-navy-900/95 p-3.5 text-white shadow-soft-lg ring-1 ring-white/10 backdrop-blur-xl"
        >
          <div className="relative shrink-0">
            <Avatar src={busyIncoming.caller?.avatar} name={busyIncoming.caller?.name} size="md" />
            <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-amber-500 ring-2 ring-navy-900">
              {busyIncoming.type === 'video' ? <Video size={11} className="text-white" /> : <Phone size={11} className="text-white" />}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{busyIncoming.caller?.name || 'Someone'} tried to call you</p>
            <p className="mt-0.5 text-xs text-white/70">
              You’re on another call — they’ve been told you’re busy. You can call them back when you’re done.
            </p>
          </div>
          <button onClick={dismiss} title="Dismiss" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
