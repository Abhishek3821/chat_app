import { BarChart3, Check } from 'lucide-react';
import { useChat } from '../../store/useChat';
import { useAuth } from '../../store/useAuth';
import { cn } from '../../lib/utils';

/** Renders a poll message with live vote bars. Tap an option to vote / unvote. */
export default function PollCard({ message, mine }) {
  const votePoll = useChat((s) => s.votePoll);
  const meId = useAuth((s) => s.user?._id);
  const poll = message.poll;
  if (!poll) return null;

  const idOf = (v) => String(v?._id ?? v);
  const total = poll.options.reduce((n, o) => n + (o.votes?.length || 0), 0);
  const chatId = message.chat?._id || message.chat;

  return (
    <div className={cn('mb-1 w-64 max-w-full', mine ? 'text-white' : 'text-content')}>
      <p className={cn('mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide', mine ? 'text-white/70' : 'text-content-muted')}>
        <BarChart3 size={12} /> Poll
      </p>
      <p className="mb-2 font-semibold leading-snug">{poll.question}</p>
      <div className="space-y-1.5">
        {poll.options.map((opt, i) => {
          const count = opt.votes?.length || 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const votedThis = (opt.votes || []).some((v) => idOf(v) === String(meId));
          return (
            <button
              key={i}
              onClick={() => votePoll(chatId, message._id, i)}
              disabled={poll.closed}
              className={cn(
                'relative block w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-default',
                mine ? 'border-white/30 hover:bg-white/10' : 'border-border hover:bg-content/5'
              )}
            >
              <span
                className={cn('absolute inset-y-0 left-0 transition-all duration-300', mine ? 'bg-white/20' : 'bg-brand-500/15')}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {votedThis && <Check size={13} className="shrink-0" />}
                  <span className="truncate">{opt.text}</span>
                </span>
                <span className="shrink-0 tabular-nums opacity-80">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className={cn('mt-1.5 text-[11px]', mine ? 'text-white/70' : 'text-content-muted')}>
        {total} vote{total === 1 ? '' : 's'}
        {poll.multi ? ' · choose multiple' : ''}
      </p>
    </div>
  );
}
