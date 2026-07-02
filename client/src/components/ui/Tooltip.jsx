import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/** Lightweight tooltip. side: 'right' | 'top'. */
export default function Tooltip({ label, side = 'right', children }) {
  const [show, setShow] = useState(false);
  return (
    <div
      className="relative flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      <AnimatePresence>
        {show && label && (
          <motion.span
            initial={{ opacity: 0, x: side === 'right' ? -4 : 0, y: side === 'top' ? 4 : 0 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-soft-lg dark:bg-navy-800',
              side === 'right' && 'left-full ml-3 top-1/2 -translate-y-1/2',
              side === 'top' && 'bottom-full mb-2 left-1/2 -translate-x-1/2'
            )}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
