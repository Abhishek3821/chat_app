import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { DEMO_MODE } from '../lib/api';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { useNotifications } from '../store/useNotifications';

/** Short preview of a message for notifications. */
function preview(m) {
  if (m?.content) return m.content;
  return { image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice message', audio: '🎤 Audio', document: '📎 Document', location: '📍 Location' }[m?.type] || 'New message';
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

    const token = localStorage.getItem('cc_token');
    const url = import.meta.env.VITE_SOCKET_URL || undefined; // same-origin via proxy
    const socket = io(url, {
      auth: { token },
      withCredentials: true,
      transports: ['websocket', 'polling'], // prefer native WebSocket, poll only as fallback
    });
    socketRef.current = socket;
    window.__ccSocket = socket;

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
    socket.on('chat-updated', () => useChat.getState().loadChats());

    // ── Contact + status notifications (bell + toast) ─────────────
    socket.on('contact-request', ({ from }) => {
      useNotifications.getState().pushLocal({ type: 'contact_request', title: 'New contact request', body: `${from?.name || 'Someone'} wants to connect`, from });
      toast(`${from?.name || 'Someone'} sent you a contact request`, { icon: '👋' });
    });
    socket.on('contact-accepted', ({ by }) => {
      useNotifications.getState().pushLocal({ type: 'contact_accepted', title: 'Request accepted', body: `${by || 'Someone'} accepted your request` });
      toast.success(`${by || 'Someone'} accepted your contact request`);
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
    socket.on('message-deleted', ({ chatId, messageId, scope }) => useChat.getState().applyDeletedMessage(chatId, messageId, scope || 'everyone'));
    socket.on('message-reaction', ({ chatId, messageId, reactions }) => useChat.getState().applyReaction(chatId, messageId, reactions));

    // Live presence
    socket.on('presence-snapshot', ({ online }) => useChat.getState().setPresenceSnapshot(online));
    socket.on('user-online', ({ userId }) => useChat.getState().setUserOnline(userId));
    socket.on('user-offline', ({ userId }) => useChat.getState().setUserOffline(userId));

    // Incoming WebRTC call → pop the call screen in "incoming" mode.
    // (The SDP offer arrives later, only after we accept — see useWebRTC.)
    socket.on('call:incoming', ({ from, callId, type, caller }) => {
      const ui = useUI.getState();
      if (ui.call) {
        socket.emit('call:reject', { to: from, callId }); // busy on another call
        return;
      }
      ui.startCall({ direction: 'incoming', peer: caller || { _id: from }, callId, type: type || 'audio' });
    });

    return () => {
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
