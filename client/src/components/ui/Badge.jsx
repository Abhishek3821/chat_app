import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';

/** Animated unread / count badge. */
export function CountBadge({ count = 0, className }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          className={cn(
            // Auto-widening pill: min-w holds the circle for 1 digit, px-1.5 +
            // leading-none let "99+" grow sideways instead of clipping, and
            // shrink-0 keeps it intact when the row it sits in runs out of space.
            'grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-brand-gradient px-1.5 text-[11px] font-bold leading-none tabular-nums text-white shadow-glow',
            className
          )}
        >
          {count > 99 ? '99+' : count}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function Chip({ children, active, className, ...props }) {
  return (
    <button
      className={cn(
        // Chips live in horizontal scrollers: nowrap + shrink-0 so a label never
        // wraps to two lines when the row is tight. Taller on phones for the tap.
        // Selected chips are moulded accent keys; the rest sit flush in the
        // surface until you press one, so the row reads as a set of buttons.
        'ring-brand neu-press shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-semibold sm:py-1.5',
        active ? 'bg-brand-gradient text-white shadow-glow' : 'neu-raised-sm bg-surface text-content-muted hover:text-content',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Dot({ className }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full', className)} />;
}
