import { cn } from '../../lib/utils';

/** ChatConnect mark — two interlocking speech bubbles forming a "C". */
export function LogoMark({ size = 36, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn(className)}>
      <defs>
        <linearGradient id="ccGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="0.5" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <path
        d="M38 22c0-8.837-7.163-16-16-16S6 13.163 6 22c0 3.05.853 5.9 2.333 8.33L6 42l11.9-2.4A15.9 15.9 0 0022 38"
        stroke="url(#ccGrad)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="9" fill="url(#ccGrad)" />
      <circle cx="29" cy="32" r="1.6" fill="white" />
      <circle cx="35" cy="32" r="1.6" fill="white" />
    </svg>
  );
}

export function LogoFull({ className, markSize = 34 }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={markSize} />
      <span className="text-xl font-extrabold tracking-tight">
        <span className="text-content">Chat</span>
        <span className="gradient-text">Connect</span>
      </span>
    </div>
  );
}
