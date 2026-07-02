import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

const variants = {
  primary: 'btn-gradient text-white',
  glass: 'glass text-content hover:bg-white/80 dark:hover:bg-white/10',
  ghost: 'text-content-muted hover:text-content hover:bg-content/5',
  outline: 'border border-border text-content hover:bg-content/5',
  danger: 'bg-red-500/90 text-white hover:bg-red-500 shadow-soft',
  subtle: 'bg-brand-500/10 text-brand-600 dark:text-brand-300 hover:bg-brand-500/20',
};

const sizes = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-10 w-10',
  'icon-sm': 'h-9 w-9',
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
        'ring-brand inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none',
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
