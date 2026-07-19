import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useAuth } from '../store/useAuth';
import { createMeetingRecorder } from '../lib/meetingRecorder';

/**
 * SFU meeting transport (LiveKit). Drop-in alternative to useMeetingRoom with
 * the SAME return shape, so MeetingRoom.jsx renders identically. MEDIA flows
 * through the LiveKit server (each participant sends one upstream → rooms scale
 * far past the mesh's ~6-peer ceiling). Chat / reactions / raise-hand / host
 * moderation / attendance still ride our own `mtg:<id>` socket room, keyed by
 * USER id here (LiveKit tiles are per-participant, not per-socket).
 */
const getSocket = () => (typeof window !== 'undefined' ? window.__ccSocket : null);
const uidOf = (identity) => String(identity || '').split('_')[0]; // "userId_rand" → userId

export function useLiveKitRoom(meetingId, { video = true, muteOnEntry = false, autoRecord = false, isHost = false, rtc } = {}) {
  const me = useAuth((s) => s.user);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remotes, setRemotes] = useState([]); // [{ socketId: userId, stream, user }]
  const [presenterSid, setPresenterSid] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [muted, setMuted] = useState(muteOnEntry && !isHost);
  const [camOff, setCamOff] = useState(!video);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [raisedHands, setRaisedHands] = useState({});
  const handRaised = !!raisedHands.me;

  const roomRef = useRef(null);
  const mediaRef = useRef(new Map()); // userId -> { audio, camera, screen } MediaStreamTracks
  const rosterRef = useRef(new Map()); // userId -> { name, avatar }
  const remotesRef = useRef([]);
  const recorderRef = useRef(null);
  const reactSeq = useRef(0);
  const closedRef = useRef(false);
  useEffect(() => { remotesRef.current = remotes; }, [remotes]);

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

  // ── LiveKit media connection ──
  useEffect(() => {
    if (!meetingId || !rtc?.url || !rtc?.token) return undefined;
    let cancelled = false;
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
      .on(RoomEvent.Disconnected, () => { if (!cancelled && !closedRef.current) { setStatus('error'); setMediaError('Disconnected from the meeting server.'); } })
      .on(RoomEvent.LocalTrackPublished, () => refreshLocal());

    const refreshLocal = () => {
      const lp = room.localParticipant;
      const cam = lp.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
      const mic = lp.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
      setLocalStream(new MediaStream([cam, mic].filter(Boolean)));
    };

    (async () => {
      try {
        await room.connect(rtc.url, rtc.token);
        if (cancelled) { room.disconnect(); return; }
        await room.localParticipant.setMicrophoneEnabled(!(muteOnEntry && !isHost));
        if (video) await room.localParticipant.setCameraEnabled(true);
        refreshLocal();
        setStatus('connected');
        if (autoRecord) setTimeout(() => startRecordingRef.current?.(), 900);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setMediaError(err?.message || 'Could not connect to the meeting server.');
      }
    })();

    return () => {
      cancelled = true;
      try { room.disconnect(); } catch { /* noop */ }
      roomRef.current = null;
      mediaRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, rtc?.url, rtc?.token]);

  // ── Socket room: attendance + chat/reactions/hand/host-moderation ──
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !meetingId) return undefined;

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

    socket.on('meeting:peer-joined', onPeerJoined);
    socket.on('meeting:chat', onChat);
    socket.on('meeting:reaction', onReaction);
    socket.on('meeting:hand', onHand);
    socket.on('meeting:force-mute', onForceMute);
    socket.on('meeting:removed', onRemoved);

    const join = () => socket.emit('meeting:join', { meetingId }, () => {});
    if (socket.connected) join();
    socket.on('connect', join);

    return () => {
      socket.off('meeting:peer-joined', onPeerJoined);
      socket.off('meeting:chat', onChat);
      socket.off('meeting:reaction', onReaction);
      socket.off('meeting:hand', onHand);
      socket.off('meeting:force-mute', onForceMute);
      socket.off('meeting:removed', onRemoved);
      socket.off('connect', join);
      socket.emit('meeting:leave', { meetingId });
    };
  }, [meetingId]);

  // ── Recording (local canvas composite) ──
  const startRecordingRef = useRef(null);
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

  return {
    localStream, screenStream, remotes, presenterSid, status, muted, camOff, sharingScreen, recording, mediaError,
    toggleMute, toggleCamera, toggleScreenShare, toggleRecording, leave,
    chatMessages, reactions, raisedHands, handRaised,
    sendChat, sendReaction, toggleHand, muteEveryone, muteParticipant, removeParticipant,
  };
}
