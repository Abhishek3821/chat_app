import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api, { DEMO_MODE } from '../lib/api';
import { useUI } from '../store/useUI';
import { useAuth } from '../store/useAuth';
import { emitSocket } from './useSocket';

/**
 * Real WebRTC audio/video calling.
 *
 * Flow (signaling relayed by the backend Socket.IO server):
 *   Caller: getUserMedia → POST /api/calls/start (creates the history record,
 *           reports if the receiver is offline) → `call:invite` rings the callee.
 *   Callee: accept → `call:accept` → caller creates the SDP offer →
 *           `call:offer` / `call:answer` / `call:ice-candidate` → media connects.
 *   Reject / cancel / end are all signaled AND persisted server-side, so call
 *   history (missed / rejected / completed) stays correct for both users.
 *
 * Media (audio+video) is peer-to-peer. With no socket/peer (e.g. demo mode) it
 * still captures your real camera/mic so you can preview the call experience.
 *
 * NOTE: getUserMedia only works on secure origins — https:// or http://localhost.
 * Over a plain-http LAN IP the browser blocks it; use https or the deployed app.
 */
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME || '',
    credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
  });
}

const RING_TIMEOUT_MS = 35000; // caller gives up ringing
const INCOMING_TIMEOUT_MS = 45000; // callee popup safety net (caller cancel normally lands first)
const CONNECT_TIMEOUT_MS = 25000; // accepted but media never connected

const getSocket = () => (typeof window !== 'undefined' ? window.__ccSocket : null);

export function useWebRTC(call) {
  const endCallStore = useUI((s) => s.endCall);
  const me = useAuth((s) => s.user);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  // incoming | calling | connecting | connected | demo | declined | noanswer |
  // unavailable | missed | ended | error
  const [status, setStatus] = useState(call?.direction === 'incoming' ? 'incoming' : 'calling');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteCandidates = useRef([]);
  const timersRef = useRef([]);
  const closedRef = useRef(false);
  const connectedAtRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Incoming calls carry the server-side record id; outgoing calls get theirs
  // from POST /api/calls/start (fallback id keeps demo/offline flows working).
  const callIdRef = useRef(call?.callId || `local-${Math.random().toString(36).slice(2, 10)}`);

  const peerId = call?.peer?._id;
  const wantVideo = call?.type === 'video';
  // Demo users have ids like "u1"; real users have Mongo ObjectIds → P2P only for real peers.
  const hasSocketPeer = Boolean(getSocket() && peerId && !DEMO_MODE && !String(peerId).startsWith('u'));

  const addTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  };

  const cleanup = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    try {
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteCandidates.current = [];
  }, []);

  /**
   * Stop media and close the overlay. A terminal status ('declined',
   * 'noanswer', 'unavailable', …) is shown briefly before closing so the
   * caller actually sees WHY the call finished.
   */
  const teardown = useCallback(
    (finalStatus = 'ended', { linger = 0 } = {}) => {
      if (closedRef.current) return;
      closedRef.current = true;
      cleanup();
      setStatus(finalStatus);
      if (linger > 0) setTimeout(endCallStore, linger);
      else endCallStore();
    },
    [cleanup, endCallStore]
  );

  const liveDuration = () =>
    connectedAtRef.current ? Math.max(0, Math.round((Date.now() - connectedAtRef.current) / 1000)) : 0;

  const getMedia = useCallback(async () => {
    const constraints = {
      audio: true,
      video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, [wantVideo]);

  const failMedia = useCallback((err) => {
    const msg =
      err?.name === 'NotAllowedError'
        ? 'Camera/microphone permission denied.'
        : err?.name === 'NotFoundError'
        ? 'No camera/microphone found on this device.'
        : err?.message || 'Could not access media devices.';
    toast.error(msg);
    setMediaError(msg);
    setStatus('error');
  }, []);

  const createPeer = useCallback(
    (stream) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate && peerId) {
          emitSocket('call:ice-candidate', { to: peerId, candidate: e.candidate, callId: callIdRef.current });
        }
      };
      pc.ontrack = (e) => setRemoteStream(e.streams[0]);
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          timersRef.current.forEach(clearTimeout);
          timersRef.current = [];
          if (!connectedAtRef.current) connectedAtRef.current = Date.now();
          setStatus('connected');
        } else if (st === 'failed' || st === 'closed') {
          // Terminal — release media and close the overlay so nothing leaks.
          teardown('ended');
        }
      };
      pcRef.current = pc;
      return pc;
    },
    [peerId, teardown]
  );

  const flushBufferedCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    for (const c of remoteCandidates.current) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* noop */
      }
    }
    remoteCandidates.current = [];
  }, []);

  // ── OUTGOING: media → create call record → ring; SDP offer is created
  //    only after the callee accepts (spec: call-user → incoming-call →
  //    accept-call → webrtc-offer → webrtc-answer → ICE). ──────────────
  useEffect(() => {
    if (!call || call.direction !== 'outgoing') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const stream = await getMedia();
        if (cancelled) return;
        void stream;

        if (!hasSocketPeer) {
          // No real peer (demo / group preview) — simulate a short ring.
          setStatus('calling');
          addTimer(() => setStatus('demo'), 1800);
          return;
        }

        // 1) Create the call record — also tells us if the receiver is offline.
        let receiverOnline = true;
        try {
          const { data } = await api.post('/calls/start', { receiverId: peerId, callType: call.type });
          if (data?.call?._id) callIdRef.current = String(data.call._id);
          receiverOnline = data?.receiverOnline !== false;
        } catch (err) {
          toast.error(err?.message || 'Could not start the call.');
          teardown('error', { linger: 900 });
          return;
        }
        if (cancelled) return;

        if (!receiverOnline) {
          toast(`${call.peer?.name || 'This user'} is offline.`, { icon: '📴' });
          teardown('unavailable', { linger: 1800 });
          return;
        }

        // 2) Ring the callee.
        emitSocket('call:invite', {
          to: peerId,
          callId: callIdRef.current,
          type: call.type,
          caller: { _id: me?._id, name: me?.name, avatar: me?.avatar },
        });
        setStatus('calling');

        // No answer in time → cancel (server logs it as missed for both sides).
        addTimer(() => {
          if (pcRef.current?.connectionState === 'connected' || statusRef.current === 'connected') return;
          emitSocket('call:cancel', { to: peerId, callId: callIdRef.current });
          toast(`${call.peer?.name || 'User'} didn't answer.`, { icon: '📵' });
          teardown('noanswer', { linger: 1600 });
        }, RING_TIMEOUT_MS);
      } catch (err) {
        if (!cancelled) failMedia(err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── INCOMING: safety net if the caller vanished without cancelling. ──
  useEffect(() => {
    if (!call || call.direction !== 'incoming') return undefined;
    const t = addTimer(() => {
      if (statusRef.current === 'incoming') teardown('missed');
    }, INCOMING_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── INCOMING: accept → capture media, tell the caller, await their offer ──
  const accept = useCallback(async () => {
    try {
      await getMedia();
      if (hasSocketPeer) {
        emitSocket('call:accept', { to: peerId, callId: callIdRef.current });
        setStatus('connecting');
        // Caller never sent the offer (crashed / cancelled at the same moment)?
        addTimer(() => {
          if (statusRef.current === 'connecting') teardown('ended');
        }, CONNECT_TIMEOUT_MS);
      } else {
        setStatus('demo');
      }
    } catch (err) {
      failMedia(err);
      // Don't leave the caller ringing against a dead popup.
      if (hasSocketPeer) emitSocket('call:reject', { to: peerId, callId: callIdRef.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMedia, peerId, hasSocketPeer, failMedia, teardown]);

  const reject = useCallback(() => {
    if (hasSocketPeer) emitSocket('call:reject', { to: peerId, callId: callIdRef.current });
    teardown('ended');
  }, [peerId, hasSocketPeer, teardown]);

  const hangUp = useCallback(() => {
    if (hasSocketPeer) {
      if (connectedAtRef.current) {
        emitSocket('call:end', { to: peerId, callId: callIdRef.current, duration: liveDuration() });
      } else if (call?.direction === 'outgoing') {
        // Hanging up while it's still ringing = cancel → missed call.
        emitSocket('call:cancel', { to: peerId, callId: callIdRef.current });
      } else {
        emitSocket('call:end', { to: peerId, callId: callIdRef.current });
      }
    }
    teardown('ended');
  }, [peerId, hasSocketPeer, call, teardown]);

  // ── Signaling listeners ──
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const mine = (cid) => !cid || cid === callIdRef.current;

    // Caller side: callee accepted → NOW create the peer + SDP offer.
    const onAccepted = async ({ callId: cid }) => {
      if (!mine(cid) || pcRef.current || !localStreamRef.current) return;
      try {
        setStatus('connecting');
        const pc = createPeer(localStreamRef.current);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitSocket('call:offer', { to: peerId, offer, callId: callIdRef.current });
      } catch {
        teardown('error');
      }
    };

    // Callee side: the caller's offer arrived → answer it.
    const onOffer = async ({ callId: cid, offer }) => {
      if (!mine(cid) || !offer || pcRef.current || !localStreamRef.current) return;
      try {
        const pc = createPeer(localStreamRef.current);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushBufferedCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        emitSocket('call:answer', { to: peerId, answer, callId: callIdRef.current });
      } catch {
        teardown('error');
      }
    };

    const onAnswer = async ({ callId: cid, answer }) => {
      if (!mine(cid) || !pcRef.current || !answer) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        await flushBufferedCandidates();
      } catch {
        /* noop */
      }
    };

    const onCandidate = async ({ callId: cid, candidate }) => {
      if (!mine(cid) || !candidate) return;
      const c = new RTCIceCandidate(candidate);
      if (pcRef.current?.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(c);
        } catch {
          /* noop */
        }
      } else {
        remoteCandidates.current.push(c);
      }
    };

    const onRejected = ({ callId: cid }) => {
      if (!mine(cid)) return;
      toast(`${call?.peer?.name || 'User'} declined the call.`, { icon: '🚫' });
      teardown('declined', { linger: 1600 });
    };

    const onCancelled = ({ callId: cid }) => {
      if (!mine(cid) || connectedAtRef.current) return;
      // Caller hung up before we answered → missed call.
      toast(`Missed ${call?.type === 'video' ? 'video ' : ''}call from ${call?.peer?.name || 'someone'}.`, { icon: '📵' });
      teardown('missed');
    };

    const onUnavailable = ({ callId: cid }) => {
      if (!mine(cid)) return;
      toast(`${call?.peer?.name || 'This user'} is offline.`, { icon: '📴' });
      teardown('unavailable', { linger: 1600 });
    };

    const onEnded = ({ callId: cid }) => {
      if (mine(cid)) teardown('ended');
    };

    // Another of MY tabs/devices already accepted or rejected this call.
    const onHandled = ({ callId: cid }) => {
      if (mine(cid) && statusRef.current === 'incoming') teardown('ended');
    };

    s.on('call:accepted', onAccepted);
    s.on('call:offer', onOffer);
    s.on('call:answer', onAnswer);
    s.on('call:ice-candidate', onCandidate);
    s.on('call:rejected', onRejected);
    s.on('call:cancelled', onCancelled);
    s.on('call:unavailable', onUnavailable);
    s.on('call:ended', onEnded);
    s.on('call:handled', onHandled);
    return () => {
      s.off('call:accepted', onAccepted);
      s.off('call:offer', onOffer);
      s.off('call:answer', onAnswer);
      s.off('call:ice-candidate', onCandidate);
      s.off('call:rejected', onRejected);
      s.off('call:cancelled', onCancelled);
      s.off('call:unavailable', onUnavailable);
      s.off('call:ended', onEnded);
      s.off('call:handled', onHandled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPeer, flushBufferedCandidates, teardown, peerId]);

  useEffect(() => () => cleanup(), [cleanup]);

  const toggleMute = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    s.getAudioTracks().forEach((t) => {
      t.enabled = muted; // currently muted → re-enable, and vice-versa
    });
    setMuted((m) => !m);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    s.getVideoTracks().forEach((t) => {
      t.enabled = camOff;
    });
    setCamOff((c) => !c);
  }, [camOff]);

  return { localStream, remoteStream, status, muted, camOff, mediaError, accept, reject, hangUp, toggleMute, toggleCamera };
}
