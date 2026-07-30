import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useAuth } from '../store/useAuth';
import { createMeetingRecorder } from '../lib/meetingRecorder';
import api from '../lib/api';

/**
 * SFU meeting transport (LiveKit). Drop-in alternative to useMeetingRoom with
 * the SAME return shape, so MeetingRoom.jsx renders identically. MEDIA flows
 * through the LiveKit server (each participant sends one upstream → rooms scale
 * far past the mesh's ~6-peer ceiling). Chat / reactions / raise-hand / host
 * moderation / attendance / the "ask to join" knock-admit flow still ride our
 * own `mtg:<id>` socket room, keyed by USER id here (LiveKit tiles are
 * per-participant, not per-socket) — mirrors useMeetingRoom's join logic so
 * the SAME RoomView UI (waiting/knocking/denied) works for both transports.
 *
 * SECURITY: an un-invited guest is never handed a LiveKit token up front —
 * `rtc` may arrive as `{ requiresAdmission: true }` (no token). This hook then
 * knocks over the socket exactly like the mesh path, and only fetches a real
 * token (GET .../rtc?pass=…) once the host admits them. See the matching gate
 * server-side in controllers/meetingController.js getMeetingRtc.
 */
const getSocket = () => (typeof window !== 'undefined' ? window.__ccSocket : null);
const uidOf = (identity) => String(identity || '').split('_')[0]; // "userId_rand" → userId

export function useLiveKitRoom(meetingId, { video = true, muteOnEntry = false, autoRecord = false, isHost = false, code, rtc } = {}) {
  const me = useAuth((s) => s.user);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remotes, setRemotes] = useState([]); // [{ socketId: userId, stream, user }]
  const [presenterSid, setPresenterSid] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | connected | waiting | knocking | denied | error | left
  const [muted, setMuted] = useState(muteOnEntry && !isHost);
  const [camOff, setCamOff] = useState(!video);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [raisedHands, setRaisedHands] = useState({});
  const [knocks, setKnocks] = useState([]); // host only: [{ socketId, userId, name, avatar }]
  const handRaised = !!raisedHands.me;

  const roomRef = useRef(null);
  const mediaRef = useRef(new Map()); // userId -> { audio, camera, screen } MediaStreamTracks
  const rosterRef = useRef(new Map()); // userId -> { name, avatar }
  const remotesRef = useRef([]);
  const recorderRef = useRef(null);
  const reactSeq = useRef(0);
  const closedRef = useRef(false);
  const mountedRef = useRef(true);
  const passRef = useRef(null); // signed admission pass (set when the host admits us)
  const rtcRef = useRef(rtc); // latest known LiveKit token/url
  useEffect(() => { remotesRef.current = remotes; }, [remotes]);
  useEffect(() => { rtcRef.current = rtc; }, [rtc]);

  // Rebuild one participant's display stream (screen preferred over camera) + audio.
  const rebuildRemote = useCallback((userId) => {
    const m = mediaRef.current.get(userId);
    setRemotes((prev) => {
      if (!m || (!m.camera && !m.screen && !m.audio)) return prev.filter((r) => r.socketId !== userId);
      const tracks = [m.screen || m.camera, m.audio].filter(Boolean);
      const stream = new MediaStream(tracks);
      const user = rosterRef.current.get(userId) || { name: userId };
      return [...prev.filter((r) => r.socketId !== userId), { socketId: userId, stream, user }];
    });
    setPresenterSid((prev) => (m?.screen ? userId : prev === userId ? null : prev));
  }, []);

  const startRecordingRef = useRef(null);

  // ── Connect to the LiveKit room once we hold a token+url we're authorized to use. ──
  const connectLiveKit = useCallback(async (url, token) => {
    if (roomRef.current || closedRef.current || !mountedRef.current) return;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const setTrack = (userId, kind, track) => {
      const cur = mediaRef.current.get(userId) || {};
      cur[kind] = track;
      mediaRef.current.set(userId, cur);
      rebuildRemote(userId);
    };
    const clearTrack = (userId, kind) => {
      const cur = mediaRef.current.get(userId);
      if (!cur) return;
      delete cur[kind];
      mediaRef.current.set(userId, cur);
      rebuildRemote(userId);
    };
    const refreshLocal = () => {
      const lp = room.localParticipant;
      const cam = lp.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
      const mic = lp.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
      setLocalStream(new MediaStream([cam, mic].filter(Boolean)));
    };

    room
      .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        const userId = uidOf(participant.identity);
        if (!rosterRef.current.has(userId)) rosterRef.current.set(userId, { name: participant.name, avatar: null });
        const mst = track.mediaStreamTrack;
        if (track.source === Track.Source.ScreenShare) setTrack(userId, 'screen', mst);
        else if (track.kind === 'video') setTrack(userId, 'camera', mst);
        else if (track.kind === 'audio') setTrack(userId, 'audio', mst);
      })
      .on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
        const userId = uidOf(participant.identity);
        if (track.source === Track.Source.ScreenShare) clearTrack(userId, 'screen');
        else if (track.kind === 'video') clearTrack(userId, 'camera');
        else if (track.kind === 'audio') clearTrack(userId, 'audio');
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        const userId = uidOf(participant.identity);
        mediaRef.current.delete(userId);
        setRemotes((prev) => prev.filter((r) => r.socketId !== userId));
        setPresenterSid((prev) => (prev === userId ? null : prev));
      })
      .on(RoomEvent.Disconnected, () => { if (mountedRef.current && !closedRef.current) { setStatus('error'); setMediaError('Disconnected from the meeting server.'); } })
      .on(RoomEvent.LocalTrackPublished, () => refreshLocal());

    try {
      await room.connect(url, token);
      if (!mountedRef.current) { room.disconnect(); return; }
      await room.localParticipant.setMicrophoneEnabled(!(muteOnEntry && !isHost));
      if (video) await room.localParticipant.setCameraEnabled(true);
      refreshLocal();
      setStatus('connected');
      if (autoRecord) setTimeout(() => startRecordingRef.current?.(), 900);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMediaError(err?.message || 'Could not connect to the meeting server.');
    }
  }, [muteOnEntry, isHost, video, autoRecord, rebuildRemote]);

  // ── Socket: attendance + ask-to-join (knock/admit) → resolves the LiveKit connection ──
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !meetingId) return undefined;
    let cancelled = false;

    const onPeerJoined = ({ userId, name, avatar }) => { if (userId) rosterRef.current.set(String(userId), { name, avatar }); };
    const onChat = ({ userId, name, avatar, text, at }) => setChatMessages((prev) => [...prev, { id: `${userId}-${at}`, socketId: userId, name, avatar, text, at, mine: false }]);
    const onReaction = ({ userId, emoji }) => {
      const id = `r-${Date.now()}-${reactSeq.current++}`;
      setReactions((prev) => [...prev, { id, socketId: String(userId), emoji }]);
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 4000);
    };
    const onHand = ({ userId, up }) => setRaisedHands((prev) => { const n = { ...prev }; if (up) n[String(userId)] = true; else delete n[String(userId)]; return n; });
    const onForceMute = ({ by }) => { roomRef.current?.localParticipant.setMicrophoneEnabled(false); setMuted(true); toast(`${by || 'The host'} muted you`, { icon: '🔇' }); };
    const onRemoved = ({ by }) => { toast.error(`${by || 'The host'} removed you from the meeting`); setStatus('left'); };
    // Someone is knocking (host only — the server sends this just to host sockets).
    const onKnock = (k) => {
      if (String(k?.meetingId) !== String(meetingId) || !k?.socketId) return;
      setKnocks((prev) => (prev.some((x) => x.socketId === k.socketId) ? prev : [...prev, k]));
      setTimeout(() => setKnocks((prev) => prev.filter((x) => x.socketId !== k.socketId)), 90000);
    };
    const onKnockHandled = ({ meetingId: mid, socketId }) => {
      if (String(mid) !== String(meetingId)) return;
      setKnocks((prev) => prev.filter((x) => x.socketId !== socketId));
    };

    let waitTimer = null;
    let knockTimer = null;
    let joinedOnce = false;

    // We're authorized (host/invited/askToJoin-off/admitted) — get a LiveKit
    // token if we don't already hold one, then connect.
    const resolveLiveKitAndConnect = async () => {
      if (rtcRef.current?.token && rtcRef.current?.url) {
        connectLiveKit(rtcRef.current.url, rtcRef.current.token);
        return;
      }
      try {
        const { data } = await api.get(`/meetings/code/${encodeURIComponent(code)}/rtc`, { params: passRef.current ? { pass: passRef.current } : undefined });
        if (cancelled) return;
        if (data?.token && data?.url) {
          rtcRef.current = data;
          connectLiveKit(data.url, data.token);
        } else {
          setStatus('error');
          setMediaError('Could not get a meeting media token.');
        }
      } catch (err) {
        if (!cancelled) { setStatus('error'); setMediaError(err?.message || 'Could not get a meeting media token.'); }
      }
    };

    const join = () => socket.emit('meeting:join', { meetingId, pass: passRef.current || undefined }, (res) => {
      if (cancelled) return;
      if (!res?.ok) {
        // "Join anytime" is off and the host isn't here yet → wait & retry.
        if (res?.waiting) {
          setStatus('waiting'); setMediaError(res.error || '');
          waitTimer = setTimeout(join, 4000);
          return;
        }
        // Ask-to-join: we knocked — hold here until the host admits or denies.
        if (res?.knocking) {
          setStatus('knocking'); setMediaError(res.error || '');
          if (knockTimer) clearTimeout(knockTimer);
          knockTimer = setTimeout(() => {
            if (!cancelled && !joinedOnce) { setStatus('denied'); setMediaError('No one let you in. Try again later.'); }
          }, 90000);
          return;
        }
        setStatus('error'); setMediaError(res?.error || 'Could not join the meeting.'); return;
      }
      if (knockTimer) { clearTimeout(knockTimer); knockTimer = null; }
      joinedOnce = true;
      setMediaError(null);
      setStatus('connecting');
      (res.peers || []).forEach((p) => { if (p.userId) rosterRef.current.set(String(p.userId), { name: p.name, avatar: p.avatar }); });
      resolveLiveKitAndConnect();
    });

    // The host let us in → re-join carrying the signed pass, then fetch a real token.
    const onAdmitted = ({ meetingId: mid, pass }) => {
      if (cancelled || String(mid) !== String(meetingId) || joinedOnce) return;
      passRef.current = pass || null;
      if (knockTimer) { clearTimeout(knockTimer); knockTimer = null; }
      setStatus('connecting');
      join();
    };
    const onDenied = ({ meetingId: mid }) => {
      if (cancelled || String(mid) !== String(meetingId) || joinedOnce) return;
      if (knockTimer) { clearTimeout(knockTimer); knockTimer = null; }
      setStatus('denied');
      setMediaError('The host didn’t let you in.');
    };

    socket.on('meeting:peer-joined', onPeerJoined);
    socket.on('meeting:chat', onChat);
    socket.on('meeting:reaction', onReaction);
    socket.on('meeting:hand', onHand);
    socket.on('meeting:force-mute', onForceMute);
    socket.on('meeting:removed', onRemoved);
    socket.on('meeting:knock', onKnock);
    socket.on('meeting:knock-handled', onKnockHandled);
    socket.on('meeting:admitted', onAdmitted);
    socket.on('meeting:denied', onDenied);

    const onConnect = () => { if (!cancelled && !joinedOnce) join(); };
    if (socket.connected) join();
    socket.on('connect', onConnect);

    return () => {
      cancelled = true;
      if (waitTimer) clearTimeout(waitTimer);
      if (knockTimer) clearTimeout(knockTimer);
      socket.off('meeting:peer-joined', onPeerJoined);
      socket.off('meeting:chat', onChat);
      socket.off('meeting:reaction', onReaction);
      socket.off('meeting:hand', onHand);
      socket.off('meeting:force-mute', onForceMute);
      socket.off('meeting:removed', onRemoved);
      socket.off('meeting:knock', onKnock);
      socket.off('meeting:knock-handled', onKnockHandled);
      socket.off('meeting:admitted', onAdmitted);
      socket.off('meeting:denied', onDenied);
      socket.off('connect', onConnect);
      socket.emit('meeting:leave', { meetingId });
    };
  }, [meetingId, code, connectLiveKit]);

  // ── Teardown: disconnect the LiveKit room (if any) when this hook unmounts. ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { roomRef.current?.disconnect(); } catch { /* noop */ }
      roomRef.current = null;
      mediaRef.current.clear();
    };
  }, []);

  // ── Recording (local canvas composite) ──
  const startRecording = useCallback(() => {
    if (recorderRef.current?.isActive()) return;
    const rec = createMeetingRecorder({
      fileName: `meeting-${meetingId}.webm`,
      getStreams: () => [localStream, ...remotesRef.current.map((r) => r.stream)].filter(Boolean),
    });
    if (rec.start()) { recorderRef.current = rec; setRecording(true); toast.success('Recording — it downloads when you stop or leave.'); }
    else toast.error('Recording isn’t supported in this browser.');
  }, [meetingId, localStream]);
  const stopRecording = useCallback(() => { recorderRef.current?.stop(); recorderRef.current = null; setRecording(false); }, []);
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  useEffect(() => () => recorderRef.current?.stop(), []);
  const toggleRecording = useCallback(() => { if (recorderRef.current?.isActive()) stopRecording(); else startRecording(); }, [startRecording, stopRecording]);

  // ── Local controls ──
  const toggleMute = useCallback(async () => {
    const lp = roomRef.current?.localParticipant; if (!lp) return;
    const next = muted; // currently muted → enable
    await lp.setMicrophoneEnabled(next);
    setMuted(!next);
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    const lp = roomRef.current?.localParticipant; if (!lp) return;
    const next = camOff; // currently off → enable
    await lp.setCameraEnabled(next);
    const cam = lp.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
    const mic = lp.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    setLocalStream(new MediaStream([cam, mic].filter(Boolean)));
    setCamOff(!next);
  }, [camOff]);

  const toggleScreenShare = useCallback(async () => {
    const lp = roomRef.current?.localParticipant; if (!lp || !video) return;
    try {
      if (sharingScreen) {
        await lp.setScreenShareEnabled(false);
        setScreenStream(null); setSharingScreen(false);
        setPresenterSid((prev) => (prev === 'me' ? null : prev));
      } else {
        await lp.setScreenShareEnabled(true);
        const scr = lp.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
        if (scr) setScreenStream(new MediaStream([scr]));
        setSharingScreen(true); setPresenterSid('me');
      }
    } catch (err) { if (err?.name !== 'NotAllowedError') toast.error('Could not start screen share.'); }
  }, [video, sharingScreen]);

  const leave = useCallback(() => { if (closedRef.current) return; closedRef.current = true; setStatus('left'); }, []);

  // ── Interactions ──
  const sendChat = useCallback((text) => {
    const body = String(text || '').trim().slice(0, 2000); if (!body) return;
    getSocket()?.emit('meeting:chat', { meetingId, text: body });
    setChatMessages((prev) => [...prev, { id: `me-${Date.now()}`, socketId: 'me', name: 'You', text: body, at: Date.now(), mine: true }]);
  }, [meetingId]);
  const sendReaction = useCallback((emoji) => {
    getSocket()?.emit('meeting:reaction', { meetingId, emoji });
    const id = `r-${Date.now()}-${reactSeq.current++}`;
    setReactions((prev) => [...prev, { id, socketId: 'me', emoji }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 4000);
  }, [meetingId]);
  const toggleHand = useCallback(() => {
    setRaisedHands((prev) => { const up = !prev.me; getSocket()?.emit('meeting:hand', { meetingId, up }); const n = { ...prev }; if (up) n.me = true; else delete n.me; return n; });
  }, [meetingId]);
  const muteEveryone = useCallback(() => { getSocket()?.emit('meeting:mute-all', { meetingId }); toast.success('Asked everyone to mute'); }, [meetingId]);
  const muteParticipant = useCallback((userId) => { getSocket()?.emit('meeting:force-mute', { meetingId, toUser: userId }); toast.success('Asked them to mute'); }, [meetingId]);
  const removeParticipant = useCallback((userId) => { getSocket()?.emit('meeting:remove', { meetingId, toUser: userId }); }, [meetingId]);
  // Host verdict on a knocking guest (admit or deny) — clears the prompt locally.
  const admitGuest = useCallback((knock, allow) => {
    if (!knock?.socketId) return;
    getSocket()?.emit('meeting:admit', { meetingId, socketId: knock.socketId, userId: knock.userId, allow: !!allow });
    setKnocks((prev) => prev.filter((k) => k.socketId !== knock.socketId));
  }, [meetingId]);

  return {
    localStream, screenStream, remotes, presenterSid, status, muted, camOff, sharingScreen, recording, mediaError,
    toggleMute, toggleCamera, toggleScreenShare, toggleRecording, leave,
    chatMessages, reactions, raisedHands, handRaised, knocks, admitGuest,
    sendChat, sendReaction, toggleHand, muteEveryone, muteParticipant, removeParticipant,
  };
}
