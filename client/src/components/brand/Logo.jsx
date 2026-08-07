import { useId } from 'react';
import { cn } from '../../lib/utils';

/** ChatConnect mark — two interlocking speech bubbles forming a "C". */
export function LogoMark({ size = 36, className }) {
  // The gradient id MUST be unique per instance. It was the literal "ccGrad",
  // and the app renders two marks at once (NavRail + TopBar), so the document
  // held duplicate ids and `url(#ccGrad)` was ambiguous — on mobile it resolved
  // against the copy inside the `hidden md:flex` rail, leaving the stroked "C"
  // and the bubble painted with nothing. All that showed was the two white eye
  // dots, which use a literal fill.
  // Colons stripped: useId yields ":r0:", and while a URL fragment tolerates
  // them, an id without punctuation is safe everywhere it might get reused.
  const gradId = `ccGrad${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn(className)}>
      <defs>
        {/* Driven by --logo-from/--logo-to (index.css), which flip between
            light and dark so the mark always has contrast. Set via `style`
            rather than the stopColor attribute — var() resolves reliably as a
            CSS property, and presentation attributes are less dependable. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: 'rgb(var(--logo-from))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--logo-to))' }} />
        </linearGradient>
      </defs>
      <path
        d="M38 22c0-8.837-7.163-16-16-16S6 13.163 6 22c0 3.05.853 5.9 2.333 8.33L6 42l11.9-2.4A15.9 15.9 0 0022 38"
        stroke={`url(#${gradId})`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="9" fill={`url(#${gradId})`} />
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
