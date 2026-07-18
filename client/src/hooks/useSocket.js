import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { DEMO_MODE, refreshAccessToken } from '../lib/api';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { useNotifications } from '../store/useNotifications';
import { useContacts } from '../store/useContacts';

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
      body: `${caller?.name || 'Someone'} is calling you on ChatConnect`,
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
    socket.on('connect', () => { refreshedForAuth = false; });
    socket.on('connect_error', async () => {
      if (refreshedForAuth) return;
      refreshedForAuth = true;
      const t = await refreshAccessToken();
      if (t) socket.connect();
    });

    const { appendMessage, setTyping } = useChat.getState();

    socket.on('receive-message', ({ chatId, message }) => {
      appendMessage(chatId, message);
      const chat = useChat.getState();
      const senderId = message.sender?._id || message.sender;
      if (String(senderId) !== String(userId)) {
        // Acknowledge delivery (✓✓ on the sender's side)...
        socket.emit('message:delivered', { chatId, messageId: message._id });
        if (chat.activeChatId === chatId && document.visibilityState === 'visible') {
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

    // Live location: apply streamed coordinate updates + end-of-share.
    socket.on('live-location', ({ chatId, messageId, lat, lng }) => useChat.getState().applyLiveLocation(chatId, messageId, lat, lng));
    socket.on('live-location-stopped', ({ chatId, message }) => { if (message) useChat.getState().applyEditedMessage(chatId, message); });

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
    socket.on('status-reply', ({ from, text }) => {
      useNotifications.getState().pushLocal({ type: 'status_reply', title: 'Status reply', body: `${from || 'Someone'}: ${text || ''}` });
      toast(`${from || 'Someone'} replied to your status`);
    });

    // Delivery / read receipts → update tick state for my messages.
    socket.on('message:status', ({ chatId, messageId, userId: uid, status }) => {
      if (status === 'delivered') useChat.getState().markDelivered(chatId, messageId, uid);
    });
    socket.on('message:read', ({ chatId, userId: uid }) => useChat.getState().markReadBy(chatId, uid));

    // Live edit / delete / reaction sync (WhatsApp-style).
    socket.on('message-edited', ({ chatId, message }) => useChat.getState().applyEditedMessage(chatId, message));
    // Poll votes (and other in-place message changes) broadcast as message-updated.
    socket.on('message-updated', ({ chatId, message }) => useChat.getState().applyEditedMessage(chatId, message));
    socket.on('message-deleted', ({ chatId, messageId, scope }) => useChat.getState().applyDeletedMessage(chatId, messageId, scope || 'everyone'));
    socket.on('message-reaction', ({ chatId, messageId, reactions }) => useChat.getState().applyReaction(chatId, messageId, reactions));

    // Live presence
    socket.on('presence-snapshot', ({ online }) => useChat.getState().setPresenceSnapshot(online));
    socket.on('user-online', ({ userId }) => useChat.getState().setUserOnline(userId));
    socket.on('user-offline', ({ userId }) => useChat.getState().setUserOffline(userId));

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
      notifyIncomingCallDesktop(caller, type);
      // Group call: attach the group chat (for the roster + header) so useWebRTC
      // can mesh-connect to everyone, not just the caller.
      const group = isGroup && chatId ? useChat.getState().chats.find((c) => c._id === chatId) || { _id: chatId, isGroup: true } : null;
      ui.startCall({ direction: 'incoming', peer: caller || { _id: from }, callId, type: type || 'audio', chatId, group });
    });

    return () => {
      clearTimeout(chatsRefetchTimer);
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
