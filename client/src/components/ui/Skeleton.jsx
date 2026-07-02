import { cn } from '../../lib/utils';

export function Skeleton({ className }) {
  return <div className={cn('shimmer rounded-lg bg-content/10', className)} />;
}

/** Chat-list row skeleton. */
export function ChatRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
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
