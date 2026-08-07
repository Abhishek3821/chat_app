import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

// Phone = full-bleed bottom sheet, so these only kick in from `sm:`. The larger
// two step up again at 2xl, where a 512px dialog looks lost on the monitor.
const widths = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg 2xl:max-w-xl',
  xl: 'sm:max-w-2xl 2xl:max-w-3xl',
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

  // Portal to <body>: ancestors with transforms/overflow (animated cards) would
  // otherwise trap and clip the fixed-position overlay inside themselves.
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50"
          />
          <motion.div
            initial={{ y: '100%', opacity: 0.5, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className={cn(
              // No `shadow-soft-lg` — it would override glass-strong's own
              // (matched light/dark) soft-UI shadow pair with a single cast.
              'glass-strong relative z-10 w-full rounded-t-3xl sm:rounded-3xl',
              // dvh, not vh: mobile browser chrome makes 92vh taller than the
              // visible area, which pushes the footer off-screen.
              'max-h-[92dvh] sm:max-h-[88dvh] overflow-hidden flex flex-col',
              // The sheet sits on the bottom edge on phones, so clear the iOS
              // home indicator. Irrelevant once it's a centred dialog.
              'pb-[env(safe-area-inset-bottom)] sm:pb-0',
              widths[size],
              className
            )}
          >
            {/* Mobile grab handle — a groove pressed into the sheet, so it looks
                like something you can actually hook a thumb into. */}
            <div className="neu-inset-sm mx-auto mt-3 h-1.5 w-10 rounded-full bg-surface-2 sm:hidden" />
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:gap-4 sm:px-6 sm:pt-5">
                <div className="min-w-0">
                  {title && <h2 className="break-words text-lg font-bold text-content">{title}</h2>}
                  {subtitle && <p className="break-words text-sm text-content-muted">{subtitle}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="neu-raised-sm neu-press ring-brand -mr-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-content-muted hover:text-content sm:h-9 sm:w-9"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {/* min-h-0 lets this shrink inside the capped-height column so a long
                body scrolls here instead of stretching the sheet past the viewport.
                overscroll-contain stops the scroll chaining to the page behind. */}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 sm:px-6">{children}</div>
            {footer && <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6 sm:py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
