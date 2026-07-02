import { cn, initials, gradientFor } from '../../lib/utils';

const sizes = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-xl',
  '2xl': 'h-28 w-28 text-3xl',
};

export default function Avatar({ src, name = '', size = 'md', online, ring, className }) {
  return (
    <div className={cn('relative shrink-0', className)}>
      {ring && (
        <span className="absolute -inset-1 rounded-full bg-brand-gradient opacity-80 blur-[1px]" aria-hidden />
      )}
      <div
        className={cn(
          'relative grid place-items-center rounded-full font-semibold text-white overflow-hidden',
          'bg-gradient-to-br',
          gradientFor(name),
          sizes[size],
          ring && 'ring-2 ring-surface'
        )}
      >
        {src ? (
          <img src={src} alt={name} className="h-full w-full object-cover drag-none" loading="lazy" />
        ) : (
          <span>{initials(name)}</span>
        )}
      </div>
      {online != null && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface',
            size === 'xs' || size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
            online ? 'bg-emerald-400' : 'bg-slate-400'
          )}
        />
      )}
    </div>
  );
}
