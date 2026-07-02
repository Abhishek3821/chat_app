import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { DEMO_MODE } from '../lib/api';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';

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

    socket.on('receive-message', ({ chatId, message }) => appendMessage(chatId, message));
    socket.on('typing-start', ({ chatId, userId }) => setTyping(chatId, userId, true));
    socket.on('typing-stop', ({ chatId, userId }) => setTyping(chatId, userId, false));
    socket.on('chat-updated', () => useChat.getState().loadChats());

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
