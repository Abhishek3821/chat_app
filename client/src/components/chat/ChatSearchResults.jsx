import { Loader2, Search, Lock } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { cn, formatDate } from '../../lib/utils';

/**
 * Results for the in-chat search.
 *
 * Replaces the message list while a query is active. The important change from
 * what this used to be: the rows come from the SERVER, so they cover the whole
 * conversation rather than only the page of messages that happened to be
 * loaded. The old behaviour filtered `messages` in memory and quietly reported
 * "no messages match" for anything above the current scroll position.
 *
 * `scope === 'local'` means the server request failed and we fell back to the
 * messages loaded on this device — the banner says so rather than pretending the
 * result set is complete.
 */
export default function ChatSearchResults({ query, results, scope, loading, hasMore, onPick }) {
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-content-muted">
        <Loader2 size={16} className="animate-spin" /> Searching this conversation…
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div>
          <span className="neu-inset mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl text-content-muted">
            <Search size={22} />
          </span>
          <p className="text-sm font-semibold text-content">No messages match “{query}”</p>
          {scope === 'local' && (
            <p className="mx-auto mt-1.5 max-w-xs text-xs text-content-muted">
              Only the messages loaded on this device were searched. Scroll back to load more, then search again.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/90 px-4 py-2 backdrop-blur">
        <p className="text-xs font-semibold text-content-muted">
          {results.length}
          {hasMore ? '+' : ''} {results.length === 1 ? 'result' : 'results'}
        </p>
        {scope === 'local' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
            <Lock size={10} /> loaded messages only
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {results.map((m) => (
          <button
            key={m._id}
            onClick={() => onPick(m)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-content/5"
          >
            <Avatar src={m.sender?.avatar} name={m.sender?.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-semibold text-content">{m.sender?.name || 'Unknown'}</p>
                <span className="shrink-0 text-[10px] text-content-muted">{formatDate(m.createdAt, 'd MMM · h:mm a')}</span>
              </div>
              <p className={cn('mt-0.5 line-clamp-2 break-words text-sm text-content-muted')}>
                <Highlight text={m.content || ''} query={query} />
              </p>
            </div>
          </button>
        ))}
      </div>

      {hasMore && (
        <p className="px-4 py-3 text-center text-[11px] text-content-muted">
          Showing the most recent matches. Narrow the search to see older ones.
        </p>
      )}
    </div>
  );
}

function Highlight({ text, query }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 160);
  const start = Math.max(0, idx - 32);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, idx)}
      <mark className="rounded bg-brand-500/25 px-0.5 text-content">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length, idx + query.length + 100)}
    </>
  );
}
