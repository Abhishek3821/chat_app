import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef(function Input({ className, icon: Icon, ...props }, ref) {
  return (
    <div className="relative">
      {Icon && (
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-content-muted" size={18} />
      )}
      <input
        ref={ref}
        className={cn(
          'ring-brand w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-content placeholder:text-content-muted transition-colors',
          Icon && 'pl-11',
          className
        )}
        {...props}
      />
    </div>
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'ring-brand w-full resize-none rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-content placeholder:text-content-muted',
        className
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium text-content">{label}</span>}
      {children}
      {hint && <span className="text-xs text-content-muted">{hint}</span>}
    </label>
  );
}
