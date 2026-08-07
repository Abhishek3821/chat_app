import { cn } from '../../lib/utils';

export default function Switch({ checked, onChange, className, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={cn(
        // Groove + knob, physically: the track is always recessed (`neu-inset-sm`
        // supplies the inner shadow either way) and only its fill changes, so
        // the knob reads as riding IN a channel rather than on a coloured bar.
        'neu-inset-sm ring-brand relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300',
        // The track is only 24px tall; an invisible ::before stretches the hit
        // area to 44px on phones without changing how the switch looks.
        "before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] sm:before:hidden",
        checked ? 'bg-brand-gradient' : 'bg-surface-2',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-gradient-to-b from-white to-mint-100 shadow-glow-lg ring-1 ring-[rgb(var(--neu-lo)/0.12)] transition-transform duration-300',
          checked && 'translate-x-5'
        )}
      />
    </button>
  );
}

export function ToggleRow({ title, description, checked, onChange, icon: Icon }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 sm:gap-4">
      {/* min-w-0 on both levels: without it a long description refuses to wrap
          and pushes the switch off the right edge. */}
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="neu-inset mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-brand-600 dark:text-brand-300">
            <Icon size={18} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{title}</p>
          {description && <p className="break-words text-xs text-content-muted">{description}</p>}
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}
