import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/* Soft-UI variants. `ghost` is the one deliberately flat member of the set —
   it exists to sit quietly inside an already-raised surface (modal footers,
   toolbars), and extruding it there would fight the container. */
const variants = {
  primary: 'btn-gradient text-white',
  glass: 'neu-raised neu-press bg-surface text-content',
  ghost: 'text-content-muted hover:text-content hover:bg-content/5',
  // Keeps its hairline so it stays distinguishable from `glass` when the two
  // appear side by side in a footer.
  outline: 'neu-raised-sm neu-press border border-border bg-surface text-content',
  // Red stays off-palette on purpose (destructive). Moulded like the accent —
  // ramping 600 -> 700 keeps white text above 4.5:1 across the whole fill,
  // where a flat red-500 only reached ~3.8:1.
  danger:
    'neu-press bg-gradient-to-b from-red-600 to-red-700 text-white shadow-glow dark:from-red-500 dark:to-red-600',
  subtle: 'neu-raised-sm neu-press bg-surface text-brand-600 dark:text-brand-300',
};

// Compact sizes grow to a ~44px tap target on phones and tighten from `sm:` up,
// where a pointer is doing the aiming.
const sizes = {
  sm: 'h-10 sm:h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-11 w-11 sm:h-10 sm:w-10',
  'icon-sm': 'h-10 w-10 sm:h-9 sm:w-9',
};

const Button = forwardRef(function Button(
  { as: Tag = motion.button, variant = 'primary', size = 'md', className, children, ...props },
  ref
) {
  return (
    <Tag
      ref={ref}
      whileTap={{ scale: 0.96 }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'ring-brand inline-flex items-center justify-center rounded-2xl font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export default Button;
