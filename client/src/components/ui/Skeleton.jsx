import { cn } from '../../lib/utils';

export function Skeleton({ className }) {
  return <div className={cn('shimmer rounded-lg bg-content/10', className)} />;
}

/** Chat-list row skeleton. Sized to match the real row (Avatar size="md",
 *  px-3 py-2.5) so the list doesn't jump when skeletons swap for real rows. */
export function ChatRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="ml-auto h-2.5 w-8" />
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/** Message bubble skeletons. */
export function MessageSkeleton() {
  return (
    <div className="space-y-4 p-6">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <Skeleton className={cn('h-12 rounded-2xl', i % 2 ? 'w-52' : 'w-64')} />
        </div>
      ))}
    </div>
  );
}
