import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * Live-caption lines over the video stage.
 *
 * Sits above the control bar (its offset is measured from the bar height, not
 * the viewport bottom) and uses a translucent navy backing so the text stays
 * readable over a bright camera feed — plain white text on video is unreadable
 * as soon as someone stands near a window.
 */
export default function CaptionOverlay({ lines = [], className }) {
  if (!lines.length) return null;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-20 z-20 flex flex-col items-center gap-1 px-3 sm:bottom-24 sm:px-6',
        className
      )}
    >
      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <motion.p
            key={l.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'max-w-[min(56rem,100%)] break-words rounded-xl bg-navy-950/75 px-3 py-1.5 text-center text-sm leading-snug text-white backdrop-blur-sm sm:text-base',
              // Interim text is provisional and will be rewritten — dim it so it
              // reads as "still being said" rather than as a finished sentence.
              !l.final && 'opacity-70'
            )}
          >
            <span className="font-semibold text-cyan-300">{l.name}: </span>
            {l.text}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  );
}
