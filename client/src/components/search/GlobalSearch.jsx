import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X, Users, MessageSquare, CalendarDays, User as UserIcon, Loader2, CornerDownLeft } from 'lucide-react';
import toast from 'react-hot-toast';

import Avatar from '../ui/Avatar';
import api from '../../lib/api';
import { cn, formatChatTime, formatDate } from '../../lib/utils';
import { useChat } from '../../store/useChat';
import { useUI } from '../../store/useUI';
import { getChatDisplay } from '../../lib/chat';
import { useAuth } from '../../store/useAuth';

/**
 * The header search — one query across people, chats, messages and meetings.
 *
 * The input in the top bar used to be decorative: no value, no handler, no
 * request. This wires it to `GET /api/search` and makes every result
 * actionable (open the thread, jump to the exact message, join the meeting).
 *
 * Behaviour that matters:
 *  • 250ms debounce, and every in-flight request is aborted when the query
 *    moves on — so fast typing can't land stale results out of order.
 *  • Full keyboard control: ⌘K/Ctrl+K to focus, ↑/↓ through a FLAT list of
 *    every result regardless of section, Enter to open, Esc to dismiss.
 *  • On phones the input has no room, so it collapses to an icon that opens a
 *    full-screen sheet with the same result list.
 */

const DEBOUNCE_MS = 250;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // mobile full-screen
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef(null);
  const sheetInputRef = useRef(null);
  const abortRef = useRef(null);
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const openModal = useUI((s) => s.openModal);

  /* Debounced, abortable fetch. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      abortRef.current?.abort();
      setResults(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { data } = await api.get('/search', { params: { q }, signal: controller.signal });
        setResults(data);
        setCursor(0);
      } catch (err) {
        // An abort is the expected outcome of typing another character.
        if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') setResults(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  /* ⌘K / Ctrl+K focuses search from anywhere. */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.matchMedia('(min-width: 768px)').matches) {
          inputRef.current?.focus();
          setOpen(true);
        } else {
          setSheetOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (sheetOpen) setTimeout(() => sheetInputRef.current?.focus(), 60);
  }, [sheetOpen]);

  /* One flat list of everything, so ↑/↓ crosses section boundaries the way a
     user expects instead of getting stuck inside a group. */
  const flat = useMemo(() => {
    if (!results) return [];
    return [
      ...(results.people || []).map((item) => ({ kind: 'person', item })),
      ...(results.chats || []).map((item) => ({ kind: 'chat', item })),
      ...(results.messages || []).map((item) => ({ kind: 'message', item })),
      ...(results.meetings || []).map((item) => ({ kind: 'meeting', item })),
    ];
  }, [results]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setSheetOpen(false);
    setQuery('');
    setResults(null);
  }, []);

  const activate = useCallback(
    async (entry) => {
      if (!entry) return;
      const { kind, item } = entry;
      try {
        if (kind === 'person') {
          const chat = await useChat.getState().openDirectChat(item._id);
          if (chat) navigate('/');
          else openModal('profile', item);
        } else if (kind === 'chat') {
          await useChat.getState().setActiveChat(item._id);
          navigate('/');
        } else if (kind === 'message') {
          const chatId = item.chat?._id || item.chat;
          navigate('/');
          await useChat.getState().jumpToMessage(chatId, item._id);
        } else if (kind === 'meeting') {
          navigate('/meetings');
        }
        dismiss();
      } catch (err) {
        toast.error(err?.response?.data?.message || err.message || 'Could not open that.');
      }
    },
    [navigate, openModal, dismiss]
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return dismiss();
    if (!flat.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(flat[cursor]);
    }
  };

  const panel = (
    <ResultsPanel
      query={query}
      results={results}
      loading={loading}
      flat={flat}
      cursor={cursor}
      me={me}
      onHover={setCursor}
      onPick={activate}
    />
  );

  return (
    <>
      {/* ── Desktop: inline input + dropdown ── */}
      <div className="relative mx-auto hidden w-full max-w-md md:block xl:max-w-lg 2xl:max-w-2xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people, messages, meetings…"
          aria-label="Search"
          // type=search + a non-credential name + autoComplete=off keep password
          // managers from treating this as the username field for the password
          // form on the Settings → Account screen (see the note there).
          type="search"
          name="app-search"
          autoComplete="off"
          className="ring-brand h-10 w-full rounded-full neu-inset bg-surface-2 pl-11 pr-16 text-sm placeholder:text-content-muted"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading && <Loader2 size={14} className="animate-spin text-content-muted" />}
          {query ? (
            <button
              onClick={dismiss}
              aria-label="Clear search"
              className="pointer-events-auto grid h-6 w-6 place-items-center rounded-md text-content-muted hover:bg-content/10 hover:text-content"
            >
              <X size={14} />
            </button>
          ) : (
            // A keycap is the most literal object in the UI, so it gets the
            // raised treatment — it should read as a key you could press.
            <kbd className="neu-raised-sm rounded-md bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold text-content-muted">
              ⌘K
            </kbd>
          )}
        </span>

        <AnimatePresence>
          {open && query.trim().length >= 2 && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.14 }}
                className="glass-strong absolute left-0 right-0 top-12 z-40 max-h-[70vh] overflow-hidden rounded-2xl shadow-soft-lg"
              >
                {panel}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile: icon → full-screen sheet ── */}
      <button
        onClick={() => setSheetOpen(true)}
        aria-label="Search"
        // ml-auto so on phones it joins the right-hand action cluster instead of
        // floating next to the title (the inline field owns the middle on md+).
        className="ring-brand ml-auto grid h-11 w-11 place-items-center rounded-xl text-content-muted transition-colors hover:bg-content/5 hover:text-content md:hidden"
      >
        <Search size={19} />
      </button>

      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex flex-col bg-[rgb(var(--app-bg))] md:hidden"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
                <input
                  ref={sheetInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search people, messages, meetings…"
                  aria-label="Search"
                  type="search"
                  name="app-search"
                  autoComplete="off"
                  // text-base: anything smaller makes iOS Safari zoom on focus.
                  className="ring-brand h-11 w-full rounded-xl neu-inset bg-surface-2 pl-11 pr-9 text-base placeholder:text-content-muted"
                />
                {loading && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-content-muted" />}
              </div>
              <button onClick={dismiss} className="shrink-0 px-2 py-2 text-sm font-semibold text-brand-600 dark:text-brand-300">
                Cancel
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Results
   ───────────────────────────────────────────────────────────── */

function ResultsPanel({ query, results, loading, flat, cursor, me, onHover, onPick }) {
  const q = query.trim();

  if (q.length < 2) {
    return <p className="px-4 py-8 text-center text-sm text-content-muted">Type at least two characters to search.</p>;
  }
  if (loading && !results) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-content-muted">
        <Loader2 size={16} className="animate-spin" /> Searching…
      </div>
    );
  }
  if (!flat.length) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-semibold text-content">No results for “{q}”</p>
        <p className="mt-1 text-xs text-content-muted">Try a name, an @username, an email, or a word from a message.</p>
      </div>
    );
  }

  // Section boundaries computed from the flat list, so the index the keyboard
  // uses and the index rendered here can never drift apart.
  let index = -1;
  const section = (kind, icon, label, render) => {
    const rows = flat.filter((f) => f.kind === kind);
    if (!rows.length) return null;
    return (
      <div key={kind} className="py-1.5">
        <SectionHeader icon={icon} label={label} count={rows.length} />
        {rows.map((entry) => {
          index += 1;
          const i = index;
          return (
            <Row key={`${kind}-${entry.item._id}`} active={i === cursor} onMouseEnter={() => onHover(i)} onClick={() => onPick(entry)}>
              {render(entry.item)}
            </Row>
          );
        })}
      </div>
    );
  };

  return (
    <div className="scrollbar-thin max-h-[70vh] divide-y divide-border overflow-y-auto">
      {section('person', UserIcon, 'People', (u) => (
        <>
          <Avatar src={u.avatar} name={u.name} size="sm" online={u.isOnline} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-content">{u.name}</p>
            <p className="truncate text-xs text-content-muted">@{u.username}</p>
          </div>
          {u.isContact && <Tag>Contact</Tag>}
        </>
      ))}

      {section('chat', Users, 'Chats', (c) => {
        const d = getChatDisplay(c, me);
        return (
          <>
            <Avatar src={d.avatar} name={d.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-content">{d.name}</p>
              <p className="truncate text-xs text-content-muted">{c.isGroup ? 'Group' : 'Direct message'}</p>
            </div>
          </>
        );
      })}

      {section('message', MessageSquare, 'Messages', (m) => {
        const chat = m.chat || {};
        const where = chat.isGroup ? chat.name : m.sender?.name;
        return (
          <>
            <Avatar src={m.sender?.avatar} name={m.sender?.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-content">
                <Highlight text={m.content} query={q} />
              </p>
              <p className="truncate text-xs text-content-muted">
                {m.sender?.name}
                {where && where !== m.sender?.name ? ` · ${where}` : ''}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-content-muted">{formatChatTime(m.createdAt)}</span>
          </>
        );
      })}

      {section('meeting', CalendarDays, 'Meetings', (mt) => (
        <>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full neu-inset bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <CalendarDays size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-content">{mt.title}</p>
            <p className="truncate text-xs text-content-muted">{formatDate(mt.startAt, 'EEE, d MMM · h:mm a')}</p>
          </div>
        </>
      ))}

    </div>
  );
}

function SectionHeader({ icon: Icon, label, count }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-2">
      <Icon size={12} className="text-content-muted" />
      <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted">{label}</p>
      <span className="text-[10px] font-semibold tabular-nums text-content-muted/70">{count}</span>
    </div>
  );
}

function Row({ children, active, onClick, onMouseEnter }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
        active ? 'bg-brand-500/10' : 'hover:bg-content/5'
      )}
    >
      {children}
      {active && <CornerDownLeft size={13} className="shrink-0 text-content-muted" />}
    </button>
  );
}

function Tag({ children }) {
  return (
    <span className="shrink-0 rounded-full bg-content/10 px-2 py-0.5 text-[10px] font-semibold text-content-muted">
      {children}
    </span>
  );
}

/** Bold the matched run so it's obvious WHY a message matched. */
function Highlight({ text = '', query }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 120);
  // Keep a little context to the left of the match instead of always starting
  // at character 0, which would push the match off the end on a long message.
  const start = Math.max(0, idx - 24);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, idx)}
      <mark className="rounded bg-brand-500/25 px-0.5 text-content">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length, idx + query.length + 80)}
    </>
  );
}
