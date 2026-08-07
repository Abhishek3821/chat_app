import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef(function Input({ className, icon: Icon, ...props }, ref) {
  return (
    // min-w-0 so the field can shrink when it sits in a flex row (its intrinsic
    // min-content width would otherwise push the row wider than the viewport).
    <div className="relative min-w-0">
      {Icon && (
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-content-muted" size={18} />
      )}
      <input
        ref={ref}
        className={cn(
          // text-base on phones: iOS Safari force-zooms the page on focus for
          // anything under 16px. Back to text-sm from sm: up.
          // Recessed well rather than a bordered box: a field is somewhere you
          // put things into, so it reads as carved out of the panel.
          'neu-inset ring-brand w-full rounded-2xl bg-surface-2 px-4 py-3 text-base text-content placeholder:text-content-muted sm:text-sm',
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
        // text-base on phones for the same iOS focus-zoom reason as Input.
        'neu-inset ring-brand w-full resize-none rounded-2xl bg-surface-2 px-4 py-3 text-base text-content placeholder:text-content-muted sm:text-sm',
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
