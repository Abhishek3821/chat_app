import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { DEMO_MODE, refreshAccessToken } from '../lib/api';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { useNotifications } from '../store/useNotifications';
import { useContacts } from '../store/useContacts';
import { useStatus } from '../store/useStatus';
import { useMeetings } from '../store/useMeetings';
import { notifyMessage, messageAlertsAllowed } from '../lib/notify';
import { playMessageTone } from '../lib/sounds';

/** Short preview of a message for notifications. */
function preview(m) {
  if (m?.content) return m.content;
  return { image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice message', audio: '🎤 Audio', document: '📎 Document', location: '📍 Location', poll: '📊 Poll' }[m?.type] || 'New message';
}

/**
 * OS-level desktop notification for an incoming call (like WhatsApp Desktop).
 * Shows only when the tab isn't focused (the in-app ringing screen covers the
 * focused case), the user's "Call notifications" setting is on, and the browser
 * permission has been granted (Settings → Notifications → Enable).
 */
function notifyIncomingCallDesktop(caller, type) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const settings = useAuth.getState().user?.settings;
    if (settings?.notifications?.calls === false) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const n = new Notification(`Incoming ${type === 'video' ? 'video' : 'voice'} call`, {
      body: `${caller?.name || 'Someone'} is calling you on ChatKonect`,
      icon: caller?.avatar || '/logo.svg',
      tag: 'cc-incoming-call', // one call notification at a time
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 35000); // matches the ring timeout
  } catch { /* notifications are best-effort */ }
}

/**
 * Resolve the Socket.IO server URL.
 * - Explicit VITE_SOCKET_URL wins.
 * - An absolute VITE_API_URL (prod) → use its origin.
 * - Otherwise in dev, connect STRAIGHT to the backend on :5000 rather than
 *   same-origin. Routing the socket through Vite's `/socket.io` proxy makes the
 *   WebSocket upgrade flaky and spams `ws proxy socket error: write ECONNABORTED`
 *   on every reconnect. Socket.IO does its own CORS, and the backend already
 *   allows localhost/LAN origins in dev, so a direct connection is clean.
 */
function resolveSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
  const api = import.meta.env.VITE_API_URL || '';
  if (/^https?:\/\//i.test(api)) return api.replace(/\/api\/?$/, '');
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:5000`;
  return undefined; // prod: same-origin
}

/**
 * Establishes the Socket.IO connection once the user is authenticated and
 * wires real-time events into the chat store. A no-op in demo mode.
 */
export function useSocket() {
  // Key on the stable user id, not the whole user object — otherwise a profile
  // edit (which replaces the object) would tear down & reconnect the socket,
  // dropping any in-progress call's signaling channel.
  const userId = useAuth((s) => s.user?._id);
  const socketRef = useRef(null);

  useEffect(() => {
    if (DEMO_MODE || !userId) return undefined;

    const url = resolveSocketUrl();
    const socket = io(url, {
      // Dynamic auth: read the LATEST access token on every (re)connect, so after
      // a token refresh the socket re-authenticates without being recreated.
      auth: (cb) => cb({ token: localStorage.getItem('cc_token') }),
      withCredentials: true,
      transports: ['websocket', 'polling'], // prefer native WebSocket, poll only as fallback
    });
    socketRef.current = socket;
    window.__ccSocket = socket;

    // If the handshake fails because the access token expired, refresh once and
    // reconnect with the fresh token. The flag prevents a refresh loop.
    let refreshedForAuth = false;
    let firstConnect = true;
    socket.on('connect', () => {
      refreshedForAuth = false;
      if (firstConnect) { firstConnect = false; return; }
      // RECONNECT after a drop: the server-side rooms are gone and every event
      // emitted while we were offline was missed. Re-join the open chat's room
      // (typing/receipts flow again) and re-sync chats + the open conversation
      // so nothing is silently lost.
      const { activeChatId } = useChat.getState();
      if (activeChatId) socket.emit('join-chat', activeChatId);
      useChat.getState().resync();
      /* Status was NOT resynced here, and that is the "I have to refresh"
         report: `status-updated` is a fire-and-forget nudge, so every status
         posted while this tab was disconnected (sleep, wifi blip, server
         restart) was lost for good and the feed stayed stale until a manual
         reload. Chats recovered via resync(); status had no equivalent. */
      useStatus.getState().load().catch(() => {});
    });
    socket.on('connect_error', async () => {
      if (refreshedForAuth) return;
      refreshedForAuth = true;
      const t = await refreshAccessToken();
      if (t) socket.connect();
    });

    const { appendMessage, setTyping } = useChat.getState();

    socket.on('receive-message', ({ chatId, message }) => {
      // ingestMessage keeps the store the single place that normalises an
      // decrypted before it enters the store, and that step is async.
      useChat.getState().ingestMessage(chatId, message);
      const chat = useChat.getState();
      const senderId = message.sender?._id || message.sender;
      if (String(senderId) !== String(userId)) {
        // Acknowledge delivery (✓✓ on the sender's side)...
        socket.emit('message:delivered', { chatId, messageId: message._id });
        const viewingThisChat = chat.activeChatId === chatId && document.visibilityState === 'visible';
        if (viewingThisChat) {
          // ...and if I'm actively viewing this chat, mark it read (coloured ✓✓).
          socket.emit('message:read', { chatId });
        } else {
          // Otherwise surface it in the notification bell.
          useNotifications.getState().pushLocal({
            type: 'message',
            title: message.sender?.name || 'New message',
            body: preview(message),
            from: message.sender,
            data: { chatId },
          });
        }
        const isGroup = !!chat.chats.find((c) => c._id === chatId)?.isGroup;
        // Ping for anything not already on screen. An OS notification only fires
        // when the window is unfocused (notifyMessage decides) — the sound plays
        // either way, which is what makes an open-but-scrolled-away tab noticeable.
        if (!viewingThisChat && messageAlertsAllowed({ isGroup, chatId })) {
          playMessageTone();
          notifyMessage({
            chatId,
            title: message.sender?.name || 'New message',
            body: preview(message),
            icon: message.sender?.avatar,
            isGroup,
          });
        }
      }
    });
    socket.on('typing-start', ({ chatId, userId }) => setTyping(chatId, userId, true));
    socket.on('typing-stop', ({ chatId, userId }) => setTyping(chatId, userId, false));
    // `chat-updated` fires for every inbound message, but `receive-message`
    // already patched lastMessage/unread locally. Refetch the list ONLY when
    // the chat is unknown here (a brand-new conversation) — refetching on every
    // message made the sidebar visibly reload each time. Debounced for bursts.
    let chatsRefetchTimer = null;
    socket.on('chat-updated', ({ chatId } = {}) => {
      const known = chatId && useChat.getState().chats.some((c) => c._id === chatId);
      if (known) return;
      clearTimeout(chatsRefetchTimer);
      chatsRefetchTimer = setTimeout(() => useChat.getState().loadChats(), 400);
    });
    socket.on('chat-disappearing', ({ chatId, seconds }) => useChat.getState().applyDisappearing(chatId, seconds));

    // Multi-device: a pin/archive/mute performed on another device of mine.
    socket.on('chat-flag', ({ chatId, action, value }) => useChat.getState().applyChatFlag(chatId, action, value));
    // Wallpaper changed on another of my devices.
    socket.on('chat-theme', ({ chatId, wallpaper, bubble }) => useChat.getState().applyChatTheme(chatId, wallpaper, bubble));

    // A scheduled message went out / was cancelled / failed. The dispatcher and
    // my other devices both emit this, so the pending list stays in step.
    socket.on('scheduled-message', (payload) => useChat.getState().applyScheduledUpdate(payload || {}));

    // Group metadata changes (rename, avatar, members, roles) sync live.
    socket.on('group-updated', ({ chat }) => { if (chat) useChat.getState().applyChatUpdate(chat); });

    // Live location: apply streamed coordinate updates + end-of-share.
    socket.on('live-location', ({ chatId, messageId, lat, lng }) => useChat.getState().applyLiveLocation(chatId, messageId, lat, lng));
    socket.on('live-location-stopped', ({ chatId, messageId }) => useChat.getState().applyLiveLocationStopped(chatId, messageId));

    // Someone pinned/unpinned a message in a chat I'm in.
    // Pin added / removed early / expired / pushed out by the 3-pin cap. `pin`
    // carries the expiry so the banner can count down without a refetch.
    socket.on('message-pinned', ({ chatId, messageId, pinned, pin }) =>
      useChat.getState().applyPinned(chatId, messageId, !!pinned, pin)
    );

    // ── Contact + status notifications (bell + toast) ─────────────
    socket.on('contact-request', ({ from }) => {
      useNotifications.getState().pushLocal({ type: 'contact_request', title: 'New contact request', body: `${from?.name || 'Someone'} wants to connect`, from });
      toast(`${from?.name || 'Someone'} sent you a contact request`, { icon: '👋' });
      useContacts.getState().load(); // the request appears in Contacts instantly
    });
    socket.on('contact-accepted', ({ by }) => {
      useNotifications.getState().pushLocal({ type: 'contact_accepted', title: 'Request accepted', body: `${by || 'Someone'} accepted your request` });
      toast.success(`${by || 'Someone'} accepted your contact request`);
      useContacts.getState().load(); // the new contact appears instantly
    });
    /* Someone unfriended me, or I unfriended them from another device. Removal is
       mutual server-side, so both parties get this — drop the row locally rather
       than refetching, and leave the chat history alone (it is not deleted). */
    socket.on('contact-removed', ({ userId: removedId, by }) => {
      if (!removedId) return;
      useContacts.getState().applyContactRemoved(removedId);
      if (by) toast(`${by} removed you from their contacts`);
    });
    // A contact posted/removed a status → refresh the Status feed live.
    // Debounced: a multi-image status post fires one refetch, not five.
    let statusRefetchTimer = null;
    socket.on('status-updated', ({ removedId } = {}) => {
      // A delete can be applied immediately — the item is simply gone, and
      // waiting for the debounced refetch leaves a story on screen that 404s
      // when opened.
      if (removedId) useStatus.getState().removeStatus(removedId);
      clearTimeout(statusRefetchTimer);
      statusRefetchTimer = setTimeout(() => useStatus.getState().load().catch(() => {}), 400);
    });
    // Someone viewed MY status — patch the count/avatars in place rather than
    // refetching: the owner is often staring at that exact screen.
    socket.on('status-viewed', (payload) => {
      if (payload?.statusId) useStatus.getState().applyStatusViewed(payload);
    });
    socket.on('status-reply', ({ from, text }) => {
      useNotifications.getState().pushLocal({ type: 'status_reply', title: 'Status reply', body: `${from || 'Someone'}: ${text || ''}` });
      toast(`${from || 'Someone'} replied to your status`);
    });
    socket.on('meeting-invited', ({ title }) => {
      useNotifications.getState().pushLocal({ type: 'meeting_reminder', title: 'Meeting invitation', body: title ? `You're invited: ${title}` : "You've been invited to a meeting" });
      toast(`📅 Meeting invitation${title ? `: ${title}` : ''}`);
      /* Pull the meeting into the list as well as announcing it. Without this the
         invitee got a toast for a meeting that was not yet anywhere on their
         Meetings page — it only appeared after a manual reload, which read as the
         invitation not having worked. */
      useMeetings.getState().load();
    });

    // Delivery / read receipts → update tick state for my messages.
    socket.on('message:status', ({ chatId, messageId, userId: uid, status }) => {
      if (status === 'delivered') useChat.getState().markDelivered(chatId, messageId, uid);
    });
    socket.on('message:read', ({ chatId, userId: uid }) => useChat.getState().markReadBy(chatId, uid));
    /* The server emits read receipts under TWO names and only one was handled.
       `message:read` (colon) comes from the socket path; `message-read` (hyphen)
       comes from the REST path (PATCH /messages/.../read) and from the chat-room
       broadcast — so marking a conversation read outside the socket never turned
       the sender's ticks blue until they reloaded. Same handler, both names. */
    socket.on('message-read', ({ chatId, userId: uid }) => useChat.getState().markReadBy(chatId, uid));

    // Live edit / delete / reaction sync (WhatsApp-style).
    socket.on('message-edited', ({ chatId, message }) => useChat.getState().applyEditedMessage(chatId, message));
    // Poll votes (and other in-place message changes) broadcast as message-updated.
    socket.on('message-updated', ({ chatId, message }) => useChat.getState().applyEditedMessage(chatId, message));
    socket.on('message-deleted', ({ chatId, messageId, scope }) => useChat.getState().applyDeletedMessage(chatId, messageId, scope || 'everyone'));
    socket.on('message-reaction', ({ chatId, messageId, reactions }) => useChat.getState().applyReaction(chatId, messageId, reactions));

    /* Presence heartbeat.
       The server treats "online" as "heartbeat within the last 5 minutes", not
       "a socket is attached" — a socket survives a backgrounded tab, a sleeping
       laptop and a dropped network, which is how everyone ended up permanently
       online. So ping only while this tab is actually VISIBLE, and stop the
       moment it isn't; the server's sweeper takes it from there.
       Sent immediately on becoming visible so coming back is instant rather
       than up to a minute late. */
    const beat = () => {
      if (document.visibilityState === 'visible' && socket.connected) socket.emit('presence:ping');
    };
    const heartbeat = setInterval(beat, 60_000);
    const onVisibility = () => beat();
    document.addEventListener('visibilitychange', onVisibility);
    socket.on('connect', beat);
    beat();

    // Live presence
    socket.on('presence-snapshot', ({ online }) => useChat.getState().setPresenceSnapshot(online));
    socket.on('user-online', ({ userId }) => useChat.getState().setUserOnline(userId));
    socket.on('user-offline', ({ userId }) => useChat.getState().setUserOffline(userId));
    /* Manual presence (available / away / busy / dnd) changed on another of MY
       devices. The server echoes it to my own room; without this listener the
       other tabs kept showing the old state until reloaded. Absolute value, not a
       toggle — the device that made the change also receives this echo. */
    socket.on('presence-state', ({ userId: uid, state }) => {
      if (String(uid) === String(userId)) useAuth.setState((s) => ({ user: { ...s.user, presenceState: state } }));
    });

    // Incoming WebRTC call → pop the call screen in "incoming" mode.
    // (The SDP offer arrives later, only after we accept — see useWebRTC.)
    socket.on('call:incoming', ({ from, callId, type, caller, chatId, isGroup }) => {
      const ui = useUI.getState();
      if (String(from) === String(userId)) return; // never ring for my own call
      if (ui.call || ui.inMeeting) {
        // Busy on another call / in a meeting → tell the caller (they see
        // "busy on another call") and surface a side notification here.
        socket.emit('call:busy', { to: from, callId, chatId });
        const who = caller || { _id: from };
        ui.showBusyIncoming({ caller: who, type: type || 'audio', at: Date.now() });
        useNotifications.getState().pushLocal({
          type: 'missed_call',
          title: `Missed ${type === 'video' ? 'video ' : ''}call`,
          body: `${who?.name || 'Someone'} called while you were on another call`,
          from: who,
        });
        return;
      }
      // OS-level notification so an unfocused/backgrounded desktop still rings.
      // (The audible ringtone is driven by call status inside useWebRTC.)
      notifyIncomingCallDesktop(caller, type);
      // Group call: attach the group chat (for the roster + header) so useWebRTC
      // can mesh-connect to everyone, not just the caller.
      const group = isGroup && chatId ? useChat.getState().chats.find((c) => c._id === chatId) || { _id: chatId, isGroup: true } : null;
      ui.startCall({ direction: 'incoming', peer: caller || { _id: from }, callId, type: type || 'audio', chatId, group });
    });

    return () => {
      clearTimeout(chatsRefetchTimer);
      clearTimeout(statusRefetchTimer);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      socket.disconnect();
      socketRef.current = null;
      window.__ccSocket = null;
    };
  }, [userId]);

  return socketRef;
}

/** Emit a socket event from anywhere (safe no-op if not connected). */
export function emitSocket(event, payload) {
  if (window.__ccSocket) window.__ccSocket.emit(event, payload);
}
