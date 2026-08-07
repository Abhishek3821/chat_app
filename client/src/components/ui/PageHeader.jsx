import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * One header for every top-level screen (Calls, Meetings, Status, Groups,
 * Contacts, …). Before this, each page hand-rolled its own: some led with an
 * accent icon chip + plain title, others with a bare `gradient-text` heading at
 * a different size, so moving between tabs the title jumped position and
 * changed colour. They all route through here now.
 *
 * Layout: [icon] title / subtitle ......... actions
 * Stacks below `xs` (a title block plus two buttons needs ~350px), and the
 * actions row keeps its own gap so buttons never collide with the subtitle.
 */
export default function PageHeader({ icon: Icon, title, subtitle, actions, className, children }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className={cn('flex flex-col gap-3 xs:flex-row xs:items-center xs:justify-between', className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
            <Icon className="text-white" size={22} strokeWidth={2.2} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-content">{title}</h1>
          {subtitle && <p className="truncate text-xs text-content-muted">{subtitle}</p>}
        </div>
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      {children}
    </motion.header>
  );
}

/**
 * Segmented control for the filter/view switches that sit under a PageHeader
 * (Meetings' Upcoming/Past, its grid⇄list toggle). A single rounded track with
 * the active segment filled, rather than N loose pills — it reads as one
 * control and makes the current selection unambiguous.
 */
export function SegmentedControl({ options, value, onChange, className, size = 'md' }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-2xl neu-inset bg-surface-2/70 p-1',
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.label ?? opt.title}
            title={opt.title ?? opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              'ring-brand inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors',
              size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-xs sm:text-[13px]',
              // Icon-only segments stay square so the track doesn't look lopsided.
              !opt.label && (size === 'sm' ? 'w-8 px-0' : 'w-9 px-0'),
              active
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-content-muted hover:bg-content/5 hover:text-content'
            )}
          >
            {Icon && <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2.2} />}
            {opt.label}
            {opt.count != null && opt.count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-bold leading-[18px] tabular-nums',
                  active ? 'bg-white/25 text-white' : 'bg-content/10 text-content-muted'
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
