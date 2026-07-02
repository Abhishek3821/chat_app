import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';

const widths = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

/**
 * Responsive modal: centered glass card on desktop, bottom-sheet on mobile.
 */
export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%', opacity: 0.5, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className={cn(
              'glass-strong relative z-10 w-full rounded-t-3xl sm:rounded-3xl shadow-soft-lg',
              'max-h-[92vh] overflow-hidden flex flex-col',
              widths[size],
              className
            )}
          >
            {/* Mobile grab handle */}
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-content/20 sm:hidden" />
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
                <div>
                  {title && <h2 className="text-lg font-bold text-content">{title}</h2>}
                  {subtitle && <p className="text-sm text-content-muted">{subtitle}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="ring-brand -mr-1 grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors hover:bg-content/10 hover:text-content"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="scrollbar-thin flex-1 overflow-y-auto px-6 pb-2">{children}</div>
            {footer && <div className="border-t border-border px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
