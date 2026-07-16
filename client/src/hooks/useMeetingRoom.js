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

export function useMeetingRoom(meetingId, { video = true, muteOnEntry = false, autoRecord = false, isHost = false } = {}) {
  const [localStream, setLocalStream] = useState(null);
  const [remotes, setRemotes] = useState([]); // [{ socketId, stream, user }]
  const [status, setStatus] = useState('connecting'); // connecting | connected | waiting | error | left
  const [muted, setMuted] = useState(muteOnEntry && !isHost); // host-controlled mute-on-entry
  const [camOff, setCamOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  const peersRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const localRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const candBufRef = useRef(new Map()); // socketId -> [candidate]
  const usersRef = useRef(new Map()); // socketId -> { userId, name, avatar }
  const remotesRef = useRef([]); // mirror of `remotes` for the recorder draw loop
  const recRef = useRef(null); // active recording context
  const startRecordingRef = useRef(null); // late-bound so the join callback can auto-start
  const cancelRef = useRef(null); // clears a pending "waiting for host" retry
  const closedRef = useRef(false);
  useEffect(() => { remotesRef.current = remotes; }, [remotes]);

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
        // Host-controlled mute-on-entry: actually disable the mic to match `muted`.
        if (muteOnEntry && !isHost) stream.getAudioTracks().forEach((t) => { t.enabled = false; });
        setLocalStream(stream);
      } catch (err) {
        const msg = err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied.' : err?.name === 'NotFoundError' ? 'No camera/microphone found.' : 'Could not access your camera/mic.';
        setMediaError(msg); setStatus('error'); toast.error(msg);
        return;
      }

      socket.on('meeting:signal', onSignal);
      socket.on('meeting:peer-joined', onPeerJoined);
      socket.on('meeting:peer-left', onPeerLeft);

      let waitTimer = null;
      const join = () => socket.emit('meeting:join', { meetingId }, (res) => {
        if (cancelled) return;
        if (!res?.ok) {
          // "Join anytime" is off and the host isn't here yet → wait & retry.
          if (res?.waiting) {
            setStatus('waiting'); setMediaError(res.error || '');
            waitTimer = setTimeout(join, 4000);
            return;
          }
          setStatus('error'); setMediaError(res?.error || 'Could not join the meeting.'); return;
        }
        setMediaError(null);
        setStatus(res.peers.length ? 'connecting' : 'connected'); // alone = connected (waiting room)
        // I'm the newcomer → I offer to everyone already here.
        res.peers.forEach((p) => { usersRef.current.set(p.socketId, { userId: p.userId, name: p.name, avatar: p.avatar }); offerTo(p.socketId); });
        // Host-controlled auto-record: begin a local recording on join.
        if (autoRecord) setTimeout(() => startRecordingRef.current?.(), 800);
      });
      cancelRef.current = () => { if (waitTimer) clearTimeout(waitTimer); };
      if (socket.connected) join(); else socket.once('connect', join);
    })();

    return () => {
      cancelled = true;
      cancelRef.current?.();
      // Finalize any recording so it downloads before we tear the streams down.
      const rec = recRef.current;
      if (rec) { recRef.current = null; cancelAnimationFrame(rec.raf); try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); } catch { /* noop */ } try { rec.audioCtx.close(); } catch { /* noop */ } }
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

  // ── Local recording: composite everyone's video onto a canvas + mix all audio,
  //    record to a .webm that downloads on stop. "Record on the local computer."
  const stopRecording = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    cancelAnimationFrame(r.raf);
    try { if (r.recorder.state !== 'inactive') r.recorder.stop(); } catch { /* noop */ }
    try { r.audioCtx.close(); } catch { /* noop */ }
    setRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    if (recRef.current || !localRef.current || typeof MediaRecorder === 'undefined') return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const videoEls = new Map();
      const elFor = (stream) => {
        if (!stream) return null;
        let el = videoEls.get(stream.id);
        if (!el) { el = document.createElement('video'); el.srcObject = stream; el.muted = true; el.playsInline = true; el.play().catch(() => {}); videoEls.set(stream.id, el); }
        return el;
      };
      const draw = () => {
        const streams = [localRef.current, ...remotesRef.current.map((r) => r.stream)].filter(Boolean);
        const n = Math.max(1, streams.length);
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const cw = canvas.width / cols; const ch = canvas.height / rows;
        streams.forEach((s, i) => {
          const el = elFor(s);
          if (el && el.readyState >= 2) { try { ctx.drawImage(el, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch); } catch { /* noop */ } }
        });
        if (recRef.current) recRef.current.raf = requestAnimationFrame(draw);
      };
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const dest = audioCtx.createMediaStreamDestination();
      const addAudio = (stream) => { if (stream?.getAudioTracks().length) { try { audioCtx.createMediaStreamSource(stream).connect(dest); } catch { /* noop */ } } };
      addAudio(localRef.current);
      remotesRef.current.forEach((r) => addAudio(r.stream));
      const mixed = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const recorder = new MediaRecorder(mixed, { mimeType: mime });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        try {
          const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
          const a = document.createElement('a');
          a.href = url; a.download = `meeting-${meetingId}.webm`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch { /* noop */ }
      };
      recRef.current = { recorder, audioCtx, raf: 0 };
      draw();
      recorder.start(1000);
      setRecording(true);
      toast.success('Recording — it downloads when you stop or leave.');
    } catch {
      toast.error('Recording isn’t supported in this browser.');
    }
  }, [meetingId]);
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  const toggleRecording = useCallback(() => { if (recRef.current) stopRecording(); else startRecording(); }, [startRecording, stopRecording]);

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

  return { localStream, remotes, status, muted, camOff, sharingScreen, recording, mediaError, toggleMute, toggleCamera, toggleScreenShare, toggleRecording, leave };
}
