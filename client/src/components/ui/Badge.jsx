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
            'grid min-w-[20px] h-5 place-items-center rounded-full bg-brand-gradient px-1.5 text-[11px] font-bold text-white shadow-glow',
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
        'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
        active ? 'bg-brand-gradient text-white shadow-glow' : 'bg-content/5 text-content-muted hover:text-content',
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
