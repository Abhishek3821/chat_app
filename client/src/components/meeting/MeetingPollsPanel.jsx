import { useMemo, useState } from 'react';
import { X, Plus, BarChart3, MessageCircleQuestion, ThumbsUp, Check, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Polls + Q&A side panel for the meeting room.
 *
 * `polls` / `questions` arrive from the server as the whole authoritative array
 * and are re-broadcast on every change, so this component derives every tally
 * from them and never keeps a counter of its own. Host-only affordances are
 * hidden when `isHost` is false — the server enforces it regardless, the UI just
 * shouldn't offer an action that will be ignored.
 *
 * Lives on the immersive navy meeting surface, so it uses navy/white rather than
 * the theme-flipping surface tokens: a meeting stays dark in both themes.
 */
export default function MeetingPollsPanel({
  open,
  onClose,
  isHost,
  myUserId,
  polls = [],
  questions = [],
  onCreatePoll,
  onVote,
  onClosePoll,
  onAsk,
  onUpvote,
  onAnswer,
}) {
  const [tab, setTab] = useState('polls');
  if (!open) return null;

  return (
    // Full-bleed overlay on phones, static side column from sm: up — the same
    // shape the in-meeting chat drawer uses, so the two feel like one system.
    <aside className="absolute inset-0 z-30 flex flex-col bg-navy-950/[0.98] sm:static sm:inset-auto sm:z-auto sm:w-80 sm:shrink-0 sm:border-l sm:border-white/10 sm:bg-navy-950/95 lg:w-96 2xl:w-[28rem]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 gap-1">
          <TabButton active={tab === 'polls'} onClick={() => setTab('polls')} icon={BarChart3} label="Polls" count={polls.length} />
          <TabButton active={tab === 'qa'} onClick={() => setTab('qa')} icon={MessageCircleQuestion} label="Q&A" count={questions.length} />
        </div>
        <button
          onClick={onClose}
          className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/60 hover:text-white sm:h-9 sm:w-9"
          aria-label="Close panel"
        >
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'polls' ? (
          <PollsTab polls={polls} isHost={isHost} myUserId={myUserId} onCreatePoll={onCreatePoll} onVote={onVote} onClosePoll={onClosePoll} />
        ) : (
          <QaTab questions={questions} isHost={isHost} myUserId={myUserId} onAsk={onAsk} onUpvote={onUpvote} onAnswer={onAnswer} />
        )}
      </div>
    </aside>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
        active ? 'bg-white text-navy-950' : 'text-white/70 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon size={15} className="shrink-0" />
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular-nums', active ? 'bg-navy-950/10' : 'bg-white/15')}>{count}</span>
      )}
    </button>
  );
}

/* ── Polls ─────────────────────────────────────────────────────────────── */
function PollsTab({ polls, isHost, myUserId, onCreatePoll, onVote, onClosePoll }) {
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);

  const reset = () => { setQuestion(''); setOptions(['', '']); setMulti(false); setCreating(false); };

  const submit = () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) return;
    onCreatePoll?.(question.trim(), opts, multi);
    reset();
  };

  return (
    <div className="space-y-3">
      {isHost && !creating && (
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 py-3 text-sm font-semibold text-white/80 transition-colors hover:border-white/40 hover:text-white"
        >
          <Plus size={16} /> New poll
        </button>
      )}

      {isHost && creating && (
        <div className="space-y-2 rounded-2xl border border-white/15 bg-white/5 p-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question…"
            className="w-full min-w-0 rounded-lg border border-white/15 bg-navy-900 px-3 py-2 text-base text-white placeholder:text-white/40 focus:border-cyan-400 focus:outline-none sm:text-sm"
          />
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={o}
                onChange={(e) => setOptions((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                placeholder={`Option ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-navy-900 px-3 py-2 text-base text-white placeholder:text-white/40 focus:border-cyan-400 focus:outline-none sm:text-sm"
              />
              {options.length > 2 && (
                <button
                  onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/50 hover:bg-red-500/15 hover:text-red-400 sm:h-9 sm:w-9"
                  aria-label={`Remove option ${i + 1}`}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button onClick={() => setOptions((p) => [...p, ''])} className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">
              + Add option
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
            Allow multiple answers
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={reset} className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10">Cancel</button>
            <button
              onClick={submit}
              disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
              className="flex-1 rounded-lg bg-white py-2.5 text-sm font-semibold text-navy-950 disabled:opacity-40"
            >
              Launch
            </button>
          </div>
        </div>
      )}

      {polls.length === 0 && !creating && (
        <p className="py-8 text-center text-sm text-white/50">
          {isHost ? 'No polls yet — launch one to gather answers.' : 'The host hasn’t started a poll yet.'}
        </p>
      )}

      {[...polls].reverse().map((poll) => (
        <PollCard key={poll._id} poll={poll} isHost={isHost} myUserId={myUserId} onVote={onVote} onClosePoll={onClosePoll} />
      ))}
    </div>
  );
}

function PollCard({ poll, isHost, myUserId, onVote, onClosePoll }) {
  const votes = poll.votes || [];
  const myChoices = useMemo(
    () => votes.find((v) => String(v.user) === String(myUserId))?.choices || [],
    [votes, myUserId]
  );
  // Tally derived from the authoritative rows — never a stored counter.
  const totalVoters = votes.length;

  const pick = (i) => {
    if (poll.closed) return;
    const next = poll.multi
      ? myChoices.includes(i) ? myChoices.filter((c) => c !== i) : [...myChoices, i]
      : [i];
    if (!next.length) return; // the server ignores an empty ballot
    onVote?.(poll._id, next);
  };

  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-semibold text-white">{poll.question}</p>
        {poll.closed && <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase text-white/70">Closed</span>}
      </div>

      <div className="mt-2.5 space-y-1.5">
        {(poll.options || []).map((opt, i) => {
          const count = votes.filter((v) => (v.choices || []).includes(i)).length;
          const pct = totalVoters ? Math.round((count / totalVoters) * 100) : 0;
          const mine = myChoices.includes(i);
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={poll.closed}
              className={cn(
                'relative block w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-colors',
                mine ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/15 hover:border-white/30',
                poll.closed && 'cursor-default'
              )}
            >
              <span className="absolute inset-y-0 left-0 bg-cyan-500/20 transition-all" style={{ width: `${pct}%` }} aria-hidden />
              <span className="relative flex items-center gap-2">
                {mine && <Check size={13} className="shrink-0 text-cyan-300" />}
                <span className="min-w-0 flex-1 break-words text-sm text-white">{opt}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-white/70">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-white/50">{totalVoters} {totalVoters === 1 ? 'vote' : 'votes'}</p>
        {isHost && !poll.closed && (
          <button onClick={() => onClosePoll?.(poll._id)} className="text-[11px] font-semibold text-white/70 hover:text-white">
            End poll
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Q&A ───────────────────────────────────────────────────────────────── */
function QaTab({ questions, isHost, myUserId, onAsk, onUpvote, onAnswer }) {
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [answering, setAnswering] = useState(null); // questionId
  const [answerText, setAnswerText] = useState('');

  // Most-upvoted first, then newest. Answered items sink to the bottom so the
  // host is always looking at what still needs a response.
  const sorted = useMemo(
    () =>
      [...questions].sort((a, b) => {
        if (!!a.answered !== !!b.answered) return a.answered ? 1 : -1;
        const up = (b.upvotes?.length || 0) - (a.upvotes?.length || 0);
        return up !== 0 ? up : new Date(b.createdAt) - new Date(a.createdAt);
      }),
    [questions]
  );

  const submit = () => {
    if (!text.trim()) return;
    onAsk?.(text.trim(), anonymous);
    setText('');
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border border-white/15 bg-white/5 p-3">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask a question…"
          className="w-full min-w-0 resize-none rounded-lg border border-white/15 bg-navy-900 px-3 py-2 text-base text-white placeholder:text-white/40 focus:border-cyan-400 focus:outline-none sm:text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
            Ask anonymously
          </label>
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-navy-950 disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </div>

      {sorted.length === 0 && <p className="py-8 text-center text-sm text-white/50">No questions yet.</p>}

      {sorted.map((q) => {
        const mineUp = (q.upvotes || []).some((u) => String(u) === String(myUserId));
        return (
          <div key={q._id} className={cn('rounded-2xl border border-white/15 bg-white/5 p-3', q.answered && 'opacity-70')}>
            <div className="flex items-start gap-2.5">
              <button
                onClick={() => onUpvote?.(q._id)}
                className={cn(
                  'flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 transition-colors',
                  mineUp ? 'bg-cyan-500/20 text-cyan-300' : 'text-white/60 hover:bg-white/10 hover:text-white'
                )}
                aria-label={mineUp ? 'Remove upvote' : 'Upvote question'}
              >
                <ThumbsUp size={14} />
                <span className="text-[11px] font-bold tabular-nums">{q.upvotes?.length || 0}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-white">{q.text}</p>
                <p className="mt-0.5 truncate text-[11px] text-white/50">
                  {q.anonymous ? 'Anonymous' : q.askedByName || 'Someone'}
                  {q.answered && <span className="ml-1.5 font-semibold text-emerald-400">· answered</span>}
                </p>
                {q.answerText && (
                  <p className="mt-1.5 break-words rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/90">{q.answerText}</p>
                )}
              </div>
            </div>

            {isHost && !q.answered && (
              <div className="mt-2">
                {answering === q._id ? (
                  <div className="space-y-2">
                    <input
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="Answer (optional)"
                      className="w-full min-w-0 rounded-lg border border-white/15 bg-navy-900 px-3 py-2 text-base text-white placeholder:text-white/40 focus:border-cyan-400 focus:outline-none sm:text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setAnswering(null); setAnswerText(''); }}
                        className="flex-1 rounded-lg py-2 text-xs font-semibold text-white/70 hover:bg-white/10"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { onAnswer?.(q._id, answerText.trim()); setAnswering(null); setAnswerText(''); }}
                        className="flex-1 rounded-lg bg-white py-2 text-xs font-semibold text-navy-950"
                      >
                        Mark answered
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAnswering(q._id)} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">
                    Answer this
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
