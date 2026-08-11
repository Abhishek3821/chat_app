import { useCallback, useEffect, useMemo, useState } from 'react';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageComposer from './MessageComposer';
import RightPanel from './RightPanel';
import ChatSearchResults from './ChatSearchResults';
import PinnedBanner from './PinnedBanner';
import { useChat } from '../../store/useChat';
import { useAuth } from '../../store/useAuth';
import { useUI } from '../../store/useUI';
import { getChatDisplay, chatPeerIds } from '../../lib/chat';
import { wallpaperStyle } from '../../lib/wallpapers';
import { emitSocket } from '../../hooks/useSocket';
import { DEMO_MODE } from '../../lib/api';

const DEMO_REPLIES = ['Absolutely! 🙌', 'Sounds perfect.', 'Haha love that 😄', 'On it right now.', "Let's do it 🚀", 'Great idea!', '👍👍'];
const EMPTY_MESSAGES = [];
const EMPTY_TYPING = [];
const EMPTY_PINS = [];
// Stable placeholder so a group "typing…" tick doesn't mint a new object every
// render (it feeds MessageList's scroll effect as a dependency).
const GROUP_TYPER = { name: 'Someone', avatar: '' };
const SEARCH_DEBOUNCE_MS = 300;

export default function ChatArea({ chat }) {
  const currentUser = useAuth((s) => s.user);
  // Narrow, per-chat subscriptions: the WHOLE conversation view must not
  // re-render on unrelated store traffic (presence blips, other chats'
  // messages, sidebar updates). Zustand actions are stable references.
  const messages = useChat((s) => s.messagesByChat[chat._id]) || EMPTY_MESSAGES;
  const typingIds = useChat((s) => s.typing[chat._id]) || EMPTY_TYPING;
  const loadingMessages = useChat((s) => s.loadingMessages);
  const sendMessage = useChat((s) => s.sendMessage);
  const appendMessage = useChat((s) => s.appendMessage);
  const reactToMessage = useChat((s) => s.reactToMessage);
  const setTyping = useChat((s) => s.setTyping);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const editMessage = useChat((s) => s.editMessage);
  const toggleStarMessage = useChat((s) => s.toggleStarMessage);
  const pinMessage = useChat((s) => s.pinMessage);
  const unpinMessage = useChat((s) => s.unpinMessage);
  const expirePin = useChat((s) => s.expirePin);
  const pins = useChat((s) => s.pinsByChat[chat._id]) || EMPTY_PINS;
  // The server is the authority (group pins are admin-only); this is what it
  // told us when the chat loaded, used only to decide what the UI offers.
  const canPin = useChat((s) => s.canPinByChat[chat._id]) ?? false;
  const searchInChat = useChat((s) => s.searchInChat);
  const jumpToMessage = useChat((s) => s.jumpToMessage);
  const resetMessageWindow = useChat((s) => s.resetMessageWindow);
  const windowed = useChat((s) => s.windowedChats[chat._id]);
  const openModal = useUI((s) => s.openModal);
  const theme = useUI((s) => s.theme);
  const defaultWallpaper = useAuth((s) => s.user?.settings?.wallpaper);
  const [replyTo, setReplyTo] = useState(null);

  // In-chat search: the query plus whatever the server came back with.
  const [search, setSearch] = useState('');
  const [searchState, setSearchState] = useState({ results: [], scope: 'none', loading: false, hasMore: false });

  const chatId = chat._id;
  const d = getChatDisplay(chat, currentUser);
  const peerIds = useMemo(() => chatPeerIds(chat, currentUser), [chat, currentUser]);
  // Group members you can @mention (populated user objects, excluding yourself).
  const mentionables = useMemo(
    () =>
      d.isGroup
        ? (chat.participants || [])
            .map((p) => p.user)
            .filter((u) => u && typeof u === 'object' && u.username && String(u._id) !== String(currentUser?._id))
        : [],
    [d.isGroup, chat.participants, currentUser?._id]
  );
  const typingUser = typingIds.length ? (d.isGroup ? GROUP_TYPER : d.peer) : null;

  // Resolve the wallpaper once per (chat, theme) rather than per render of the list.
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const wallpaper = useMemo(
    () => wallpaperStyle(chat.wallpaper, defaultWallpaper, isDark),
    [chat.wallpaper, defaultWallpaper, isDark]
  );

  // messageId → expiry. A Map of primitives, so MessageBubble's memo() still
  // holds: a bubble only re-renders when ITS pin state changes.
  const pinnedMap = useMemo(() => new Map(pins.map((p) => [p.messageId, p.expiresAt])), [pins]);

  /* Retire a pin the moment its clock runs out, rather than waiting for the
     server's sweeper tick — otherwise the banner lingers up to a minute past
     the time it just finished counting down to. One timer for the pin that
     expires soonest; it re-arms as that one goes. */
  useEffect(() => {
    if (!pins.length) return undefined;
    const soonest = pins.reduce((a, b) => (new Date(a.expiresAt) < new Date(b.expiresAt) ? a : b));
    const ms = new Date(soonest.expiresAt).getTime() - Date.now();
    // Clamp: setTimeout overflows past ~24.8 days, and a pin caps at 24h anyway.
    const timer = setTimeout(() => expirePin(chatId, soonest.messageId), Math.max(0, Math.min(ms, 86_400_000)));
    return () => clearTimeout(timer);
  }, [pins, chatId, expirePin]);

  // Stable callbacks so the memoized MessageList/MessageBubble tree only
  // re-renders when the messages themselves change.
  const onReact = useCallback((id, emoji) => reactToMessage(chatId, id, emoji), [reactToMessage, chatId]);
  const onStar = useCallback((m) => toggleStarMessage(chatId, m._id), [toggleStarMessage, chatId]);
  const onDelete = useCallback((m, scope) => deleteMessage(chatId, m._id, scope), [deleteMessage, chatId]);
  const onEdit = useCallback((m, content) => editMessage(chatId, m._id, content), [editMessage, chatId]);
  const onForward = useCallback((m) => openModal('forwardMessage', { message: m }), [openModal]);
  const onPin = useCallback((m, hours) => pinMessage(chatId, m._id, hours), [pinMessage, chatId]);
  const onUnpin = useCallback((m) => unpinMessage(chatId, m._id || m), [unpinMessage, chatId]);

  useEffect(() => {
    setSearch(''); // reset in-chat search when switching conversations
    setSearchState({ results: [], scope: 'none', loading: false, hasMore: false });
    emitSocket('join-chat', chat._id);
    emitSocket('message:read', { chatId: chat._id }); // opening the chat = read
    return () => emitSocket('leave-chat', chat._id);
  }, [chat._id]);

  /* Debounced server-side search over the whole conversation. Guarded against
     out-of-order responses: a slow request for an old query must not overwrite
     the results for the one being typed now. */
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchState({ results: [], scope: 'none', loading: false, hasMore: false });
      return undefined;
    }
    let stale = false;
    setSearchState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      const res = await searchInChat(chatId, q);
      if (stale) return;
      setSearchState({ results: res.messages, scope: res.scope, loading: false, hasMore: res.hasMore });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search, chatId, searchInChat]);

  // Re-mark read when new messages land while I'm looking at this chat.
  useEffect(() => {
    if (messages.length) emitSocket('message:read', { chatId: chat._id });
  }, [messages.length, chat._id]);

  const handleSend = async (payload) => {
    await sendMessage({ chatId: chat._id, ...payload });
    setReplyTo(null);

    // Demo mode: simulate a lively reply from the peer.
    if (DEMO_MODE && d.peer) {
      setTimeout(() => setTyping(chat._id, d.peer._id, true), 500);
      setTimeout(() => {
        setTyping(chat._id, d.peer._id, false);
        appendMessage(chat._id, {
          _id: `demo-${Date.now()}`,
          sender: d.peer,
          content: DEMO_REPLIES[Math.floor(payload.content?.length || 0) % DEMO_REPLIES.length],
          type: 'text',
          createdAt: new Date().toISOString(),
          status: 'read',
        });
      }, 2000);
    }
  };

  /** Open a search result: load the history around it if needed, then flash it. */
  const openResult = async (m) => {
    setSearch('');
    await jumpToMessage(chatId, m._id);
  };

  const searching = search.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader chat={chat} currentUser={currentUser} search={search} onSearch={setSearch} />

        {/* Pinned strip — hidden while searching, where the results list owns
            the space and a pin has no bearing on what you're looking for. */}
        {!searching && (
          <PinnedBanner
            pins={pins}
            canPin={canPin}
            meId={currentUser?._id}
            onJump={(messageId) => jumpToMessage(chatId, messageId)}
            onUnpin={(messageId) => unpinMessage(chatId, messageId)}
          />
        )}

        {searching ? (
          <ChatSearchResults
            query={search.trim()}
            results={searchState.results}
            scope={searchState.scope}
            loading={searchState.loading}
            hasMore={searchState.hasMore}
            onPick={openResult}
          />
        ) : (
          <MessageList
            chatId={chatId}
            messages={messages}
            loading={loadingMessages}
            isGroup={d.isGroup}
            currentUser={currentUser}
            peerIds={peerIds}
            typingUser={typingUser}
            wallpaper={wallpaper}
            windowed={windowed}
            onReturnToLatest={() => resetMessageWindow(chatId)}
            pinnedMap={pinnedMap}
            canPin={canPin}
            onReact={onReact}
            onReply={setReplyTo}
            onStar={onStar}
            onPin={onPin}
            onUnpin={onUnpin}
            onDelete={onDelete}
            onEdit={onEdit}
            onForward={onForward}
          />
        )}

        <MessageComposer chatId={chat._id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSend={handleSend} mentionables={mentionables} />
      </div>
      <RightPanel chat={chat} currentUser={currentUser} />
    </div>
  );
}
