import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * Beautiful empty state with a floating gradient illustration built from
 * the provided Lucide icon.
 */
export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('grid h-full place-items-center p-8 text-center', className)}>
      <div className="max-w-sm">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          className="relative mx-auto mb-6 h-28 w-28"
        >
          <div className="absolute inset-0 rounded-[2rem] bg-brand-gradient opacity-20 blur-2xl" />
          <div className="animate-float glass relative grid h-full w-full place-items-center rounded-[2rem] shadow-soft">
            {Icon && <Icon className="text-brand-500" size={44} strokeWidth={1.5} />}
          </div>
        </motion.div>
        <h3 className="text-lg font-bold text-content">{title}</h3>
        {description && <p className="mt-1.5 text-sm text-content-muted">{description}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
