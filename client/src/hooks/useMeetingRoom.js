import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';

/**
 * Full-mesh WebRTC for a Google-Meet-style meeting room. Every participant is a
 * separate RTCPeerConnection keyed by the remote SOCKET id (a user can even join
 * from two tabs). Signaling is relayed opaquely by the server between sockets in
 * the same `mtg:<id>` room:
 *   - The NEWCOMER offers to each peer already in the room (from meeting:join).
 *   - Existing peers learn of the newcomer via meeting:peer-joined and simply
 *     answer the offer that arrives — so no two peers ever offer each other (no glare).
 */
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
    username: import.meta.env.VITE_TURN_USERNAME || '',
    credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
  });
}
const AUDIO_ENHANCE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const getSocket = () => (typeof window !== 'undefined' ? window.__ccSocket : null);

export function useMeetingRoom(meetingId, { video = true } = {}) {
  const [localStream, setLocalStream] = useState(null);
  const [remotes, setRemotes] = useState([]); // [{ socketId, stream, user }]
  const [status, setStatus] = useState('connecting'); // connecting | connected | error | left
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  const peersRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const localRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const candBufRef = useRef(new Map()); // socketId -> [candidate]
  const usersRef = useRef(new Map()); // socketId -> { userId, name, avatar }
  const closedRef = useRef(false);

  const emitSignal = useCallback((to, data) => {
    getSocket()?.emit('meeting:signal', { meetingId, to, data });
  }, [meetingId]);

  const upsertRemote = useCallback((socketId, stream) => {
    setRemotes((prev) => {
      const user = usersRef.current.get(socketId) || { socketId };
      return [...prev.filter((r) => r.socketId !== socketId), { socketId, stream, user }];
    });
  }, []);

  const closePeer = useCallback((socketId) => {
    const pc = peersRef.current.get(socketId);
    if (pc) { try { pc.close(); } catch { /* noop */ } peersRef.current.delete(socketId); }
    candBufRef.current.delete(socketId);
    setRemotes((prev) => prev.filter((r) => r.socketId !== socketId));
  }, []);

  const createPeer = useCallback((socketId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    if (localRef.current) localRef.current.getTracks().forEach((t) => pc.addTrack(t, localRef.current));
    if (screenTrackRef.current) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(screenTrackRef.current).catch(() => {});
    }
    pc.onicecandidate = (e) => { if (e.candidate) emitSignal(socketId, { kind: 'ice', candidate: e.candidate }); };
    pc.ontrack = (e) => upsertRemote(socketId, e.streams[0]);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') setStatus('connected');
      else if (st === 'failed' || st === 'closed') closePeer(socketId);
    };
    peersRef.current.set(socketId, pc);
    return pc;
  }, [emitSignal, upsertRemote, closePeer]);

  const flushCandidates = useCallback(async (socketId) => {
    const pc = peersRef.current.get(socketId);
    if (!pc?.remoteDescription) return;
    for (const c of candBufRef.current.get(socketId) || []) {
      try { await pc.addIceCandidate(c); } catch { /* noop */ }
    }
    candBufRef.current.set(socketId, []);
  }, []);

  // ── Bootstrap: media → join room → mesh ──
  useEffect(() => {
    if (!meetingId) return undefined;
    const socket = getSocket();
    if (!socket) { setStatus('error'); setMediaError('No live connection.'); return undefined; }
    let cancelled = false;

    const offerTo = async (socketId) => {
      try {
        const pc = createPeer(socketId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitSignal(socketId, { kind: 'offer', sdp: offer });
      } catch { closePeer(socketId); }
    };

    const onSignal = async ({ from, data }) => {
      if (!from || !data) return;
      try {
        if (data.kind === 'offer') {
          const pc = peersRef.current.get(from) || createPeer(from);
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await flushCandidates(from);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emitSignal(from, { kind: 'answer', sdp: answer });
        } else if (data.kind === 'answer') {
          const pc = peersRef.current.get(from);
          if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); await flushCandidates(from); }
        } else if (data.kind === 'ice') {
          const pc = peersRef.current.get(from);
          const cand = new RTCIceCandidate(data.candidate);
          if (pc?.remoteDescription) { try { await pc.addIceCandidate(cand); } catch { /* noop */ } }
          else { const buf = candBufRef.current.get(from) || []; buf.push(cand); candBufRef.current.set(from, buf); }
        }
      } catch { /* a bad signal must not crash the room */ }
    };

    const onPeerJoined = ({ socketId, userId, name, avatar }) => {
      usersRef.current.set(socketId, { userId, name, avatar });
      // The newcomer offers to US — just record them and wait for their offer.
    };
    const onPeerLeft = ({ socketId }) => closePeer(socketId);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO_ENHANCE }, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] || null;
        setLocalStream(stream);
      } catch (err) {
        const msg = err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied.' : err?.name === 'NotFoundError' ? 'No camera/microphone found.' : 'Could not access your camera/mic.';
        setMediaError(msg); setStatus('error'); toast.error(msg);
        return;
      }

      socket.on('meeting:signal', onSignal);
      socket.on('meeting:peer-joined', onPeerJoined);
      socket.on('meeting:peer-left', onPeerLeft);

      const join = () => socket.emit('meeting:join', { meetingId }, (res) => {
        if (cancelled) return;
        if (!res?.ok) { setStatus('error'); setMediaError(res?.error || 'Could not join the meeting.'); return; }
        setStatus(res.peers.length ? 'connecting' : 'connected'); // alone = connected (waiting room)
        // I'm the newcomer → I offer to everyone already here.
        res.peers.forEach((p) => { usersRef.current.set(p.socketId, { userId: p.userId, name: p.name, avatar: p.avatar }); offerTo(p.socketId); });
      });
      if (socket.connected) join(); else socket.once('connect', join);
    })();

    return () => {
      cancelled = true;
      socket.off('meeting:signal', onSignal);
      socket.off('meeting:peer-joined', onPeerJoined);
      socket.off('meeting:peer-left', onPeerLeft);
      socket.emit('meeting:leave', { meetingId });
      peersRef.current.forEach((pc) => { try { pc.close(); } catch { /* noop */ } });
      peersRef.current.clear();
      candBufRef.current.clear();
      localRef.current?.getTracks().forEach((t) => t.stop());
      try { screenTrackRef.current?.stop(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const toggleMute = useCallback(() => {
    const s = localRef.current; if (!s) return;
    s.getAudioTracks().forEach((t) => { t.enabled = muted; });
    setMuted((m) => !m);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const s = localRef.current; if (!s) return;
    s.getVideoTracks().forEach((t) => { t.enabled = camOff; });
    setCamOff((c) => !c);
  }, [camOff]);

  const stopShare = useCallback(() => {
    const cam = cameraTrackRef.current || null;
    peersRef.current.forEach((pc) => { const sender = pc.getSenders().find((s) => s.track?.kind === 'video'); if (sender) sender.replaceTrack(cam).catch(() => {}); });
    try { screenTrackRef.current?.stop(); } catch { /* noop */ }
    screenTrackRef.current = null;
    setSharingScreen(false);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (!video) return;
    if (sharingScreen) { stopShare(); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenTrackRef.current = track;
      peersRef.current.forEach((pc) => { const sender = pc.getSenders().find((s) => s.track?.kind === 'video'); if (sender) sender.replaceTrack(track).catch(() => {}); });
      setSharingScreen(true);
      track.onended = () => stopShare();
    } catch (err) { if (err?.name !== 'NotAllowedError') toast.error('Could not start screen share.'); }
  }, [video, sharingScreen, stopShare]);

  const leave = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setStatus('left');
  }, []);

  return { localStream, remotes, status, muted, camOff, sharingScreen, mediaError, toggleMute, toggleCamera, toggleScreenShare, leave };
}
