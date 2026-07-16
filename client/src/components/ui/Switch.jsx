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
        'ring-brand relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300',
        checked ? 'bg-brand-gradient' : 'bg-content/15',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300',
          checked && 'translate-x-5'
        )}
      />
    </button>
  );
}

export function ToggleRow({ title, description, checked, onChange, icon: Icon }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-500">
            <Icon size={18} />
          </span>
        )}
        <div>
          <p className="text-sm font-medium text-content">{title}</p>
          {description && <p className="text-xs text-content-muted">{description}</p>}
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}
