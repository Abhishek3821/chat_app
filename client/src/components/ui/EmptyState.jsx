import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * Beautiful empty state with a floating gradient illustration built from
 * the provided Lucide icon.
 */
export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('grid h-full place-items-center p-6 text-center sm:p-8', className)}>
      <div className="max-w-sm">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          className="relative mx-auto mb-6 h-28 w-28"
        >
          <div className="absolute inset-0 rounded-[2rem] bg-brand-gradient opacity-20 blur-2xl" />
          {/* Raised plinth with the icon pressed into it — the one place in the
              app that gets both states at once, since it's the focal point of
              an otherwise empty screen. */}
          <div className="animate-float neu-raised-lg relative grid h-full w-full place-items-center rounded-[2rem] bg-surface">
            <span className="neu-inset grid h-20 w-20 place-items-center rounded-3xl">
              {Icon && <Icon className="text-brand-600 dark:text-brand-300" size={38} strokeWidth={1.5} />}
            </span>
          </div>
        </motion.div>
        <h3 className="text-balance text-lg font-bold text-content">{title}</h3>
        {description && <p className="mt-1.5 text-sm text-content-muted">{description}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
