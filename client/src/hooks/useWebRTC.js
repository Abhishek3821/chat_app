import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api, { DEMO_MODE } from '../lib/api';
import { useUI } from '../store/useUI';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { emitSocket } from './useSocket';

/**
 * Real WebRTC audio/video calling — 1:1 and small group ("add people").
 *
 * Flow (signaling relayed by the backend Socket.IO server):
 *   Caller: getUserMedia → POST /api/calls/start (creates the history record,
 *           reports if the receiver is offline) → `call:invite` rings the callee.
 *   Callee: accept → `call:accept` → caller creates the SDP offer →
 *           `call:offer` / `call:answer` / `call:ice-candidate` → media connects.
 *   Reject / cancel / end are all signaled AND persisted server-side, so call
 *   history (missed / rejected / completed) stays correct for both users.
 *
 * GROUP: every remote party is a separate peer connection keyed by user id, so
 * the exact same, proven negotiation runs once per leg. `addParticipants()`
 * rings extra contacts into the SAME call; when they accept, a new leg is
 * negotiated and their tile appears. Everyone added is connected to the person
 * who added them (the host), so all parties can see/hear the host.
 *
 * Media (audio+video) is peer-to-peer. With no socket/peer (e.g. demo mode) it
 * still captures your real camera/mic (and screen) so you can preview the UX.
 *
 * NOTE: getUserMedia/getDisplayMedia only work on secure origins — https:// or
 * http://localhost. Over a plain-http LAN IP the browser blocks it.
 */
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
// TURN relay(s) — required for MEDIA to flow between users behind symmetric NAT
// / strict firewalls (mobile networks, most home routers across the internet).
// Without one, calls ring and "connect" but no video/audio ever arrives.
// VITE_TURN_URL may be a single URL or a comma-separated list (turn: and turns:).
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
    username: import.meta.env.VITE_TURN_USERNAME || '',
    credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
  });
} else {
  // Default: Open Relay (metered.ca) — a free public TURN service. Replace with
  // your own TURN (set VITE_TURN_URL/-USERNAME/-CREDENTIAL) for production scale.
  ICE_SERVERS.push({
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  });
}

// Browser DSP applied to the outgoing mic track. Toggled live via
// track.applyConstraints() so "Noise cancellation" is a real control, not a stub.
const AUDIO_ENHANCE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

const MAX_ICE_RESTARTS = 3; // per leg, before we give up and drop it

const RING_TIMEOUT_MS = 35000; // caller gives up ringing a leg
const INCOMING_TIMEOUT_MS = 45000; // callee popup safety net
const CONNECT_TIMEOUT_MS = 25000; // accepted but media never connected

const getSocket = () => (typeof window !== 'undefined' ? window.__ccSocket : null);

export function useWebRTC(call) {
  const endCallStore = useUI((s) => s.endCall);
  const me = useAuth((s) => s.user);

  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]); // [{ id, stream, user }]
  const [remotePresenters, setRemotePresenters] = useState([]); // remote ids currently screen-sharing
  // incoming | calling | connecting | connected | demo | declined | noanswer |
  // unavailable | missed | busy | ended | error
  const [status, setStatus] = useState(call?.direction === 'incoming' ? 'incoming' : 'calling');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [noiseCancel, setNoiseCancel] = useState(true); // mic DSP on by default
  const [mediaError, setMediaError] = useState(null);

  const peersRef = useRef(new Map()); // remoteId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const cameraTrackRef = useRef(null); // original camera track (to restore after screen share)
  const screenTrackRef = useRef(null);
  const candBufRef = useRef(new Map()); // remoteId -> [RTCIceCandidate] buffered until remoteDescription
  const restartRef = useRef(new Map()); // remoteId -> ICE-restart attempt count
  const participantsRef = useRef(new Map()); // remoteId -> { _id, name, avatar }
  const timersRef = useRef([]); // primary-call timers
  const legTimersRef = useRef(new Map()); // remoteId -> ring timeout for an added leg
  const closedRef = useRef(false);
  const connectedAtRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Incoming calls carry the server-side record id; outgoing calls get theirs
  // from POST /api/calls/start (fallback id keeps demo/offline flows working).
  const callIdRef = useRef(call?.callId || `local-${Math.random().toString(36).slice(2, 10)}`);

  const peerId = call?.peer?._id ? String(call.peer._id) : null; // primary peer (1:1)
  const wantVideo = call?.type === 'video';

  // ── Group call context ──
  // A group call carries the group chat (from the header) or just its id + the
  // group flag (from an incoming invite). Every participant connects to every
  // other via a full mesh keyed by user id.
  const groupChatId = call?.chatId || (call?.group?.isGroup ? String(call.group._id) : null) || null;
  const groupChatIdRef = useRef(groupChatId);
  const isGroupCall = Boolean(groupChatId);
  const hasGroup = Boolean(getSocket() && !DEMO_MODE && isGroupCall);
  const myId = me?._id ? String(me._id) : null;
  const helloBackRef = useRef(new Set()); // remoteIds we've already re-greeted (mesh glare control)

  // Demo users have ids like "u1"; real users have Mongo ObjectIds → P2P only for
  // real 1:1 peers (group calls use the mesh path, never this single-peer flow).
  const hasSocketPeer = Boolean(
    getSocket() && peerId && !DEMO_MODE && !isGroupCall && !String(peerId).startsWith('u')
  );

  const addTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  };

  // Emit a call signal with the shared callId + (group) chatId attached. The
  // server uses chatId to authorize signaling between group members who aren't
  // personal contacts; it's undefined for 1:1 calls (contacts gate applies).
  const emitSig = useCallback((event, extra = {}) => {
    emitSocket(event, { callId: callIdRef.current, chatId: groupChatIdRef.current || undefined, ...extra });
  }, []);

  /** The other members of this group call, resolved from the group chat. */
  const rosterUsers = useCallback(() => {
    let chat = call?.group?.participants ? call.group : null;
    if (!chat && groupChatId) chat = useChat.getState().chats.find((c) => c._id === groupChatId) || null;
    return (chat?.participants || [])
      .map((p) => {
        const u = p.user || p;
        return { _id: String(u._id || u), name: u.name, avatar: u.avatar };
      })
      .filter((u) => u._id && u._id !== myId);
  }, [call, groupChatId, myId]);

  /** Tell every roster member "I'm here and ready" so the mesh can form. */
  const announceReady = useCallback(() => {
    rosterUsers().forEach((u) => {
      participantsRef.current.set(u._id, u);
      emitSig('call:accept', { to: u._id });
    });
  }, [rosterUsers, emitSig]);

  const upsertRemote = useCallback((id, stream) => {
    const key = String(id);
    setRemoteStreams((prev) => {
      const user = participantsRef.current.get(key) || { _id: key };
      return [...prev.filter((r) => r.id !== key), { id: key, stream, user }];
    });
  }, []);

  const dropRemote = useCallback((id) => {
    const key = String(id);
    setRemoteStreams((prev) => prev.filter((r) => r.id !== key));
  }, []);

  const closePeer = useCallback(
    (id) => {
      const key = String(id);
      const pc = peersRef.current.get(key);
      if (pc) {
        try {
          pc.close();
        } catch {
          /* noop */
        }
        peersRef.current.delete(key);
      }
      candBufRef.current.delete(key);
      restartRef.current.delete(key);
      const lt = legTimersRef.current.get(key);
      if (lt) {
        clearTimeout(lt);
        legTimersRef.current.delete(key);
      }
      setRemotePresenters((prev) => prev.filter((id) => id !== key));
      dropRemote(key);
    },
    [dropRemote]
  );

  const cleanup = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    legTimersRef.current.forEach(clearTimeout);
    legTimersRef.current.clear();
    peersRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* noop */
      }
    });
    peersRef.current.clear();
    candBufRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    try {
      screenTrackRef.current?.stop();
    } catch {
      /* noop */
    }
    screenTrackRef.current = null;
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
      audio: { ...AUDIO_ENHANCE },
      video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] || null;
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

  /**
   * Best-effort ICE restart for a leg that dropped/failed. Only the leg's
   * INITIATOR (the side that made the original offer) restarts, so the two
   * sides can't glare. Renegotiation reuses the normal offer/answer path.
   */
  const attemptIceRestart = useCallback(async (key) => {
    const pc = peersRef.current.get(key);
    if (!pc || closedRef.current || !pc.__ccInitiator) return;
    const n = restartRef.current.get(key) || 0;
    if (n >= MAX_ICE_RESTARTS) return;
    restartRef.current.set(key, n + 1);
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      emitSig('call:offer', { to: key, offer });
    } catch {
      /* noop — the connectionstate handler will drop it if it stays failed */
    }
  }, [emitSig]);

  const createPeer = useCallback(
    (remoteId, stream, initiator = false) => {
      const key = String(remoteId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.__ccInitiator = initiator; // only the offerer performs ICE restarts
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // If a screen share is already live, send the screen (not the camera) on this new leg.
      if (screenTrackRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrackRef.current).catch(() => {});
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          emitSig('call:ice-candidate', { to: key, candidate: e.candidate });
        }
      };
      pc.ontrack = (e) => upsertRemote(key, e.streams[0]);
      const isPrimaryLeg = () => key === String(peerId);
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          const lt = legTimersRef.current.get(key);
          if (lt) {
            clearTimeout(lt);
            legTimersRef.current.delete(key);
          }
          timersRef.current.forEach(clearTimeout);
          timersRef.current = [];
          restartRef.current.delete(key); // recovered — reset the restart budget
          if (!connectedAtRef.current) connectedAtRef.current = Date.now();
          // Already presenting when this leg connected → tell the new peer, so
          // they render the screen with the right fit (contain, spotlight).
          if (screenTrackRef.current) emitSig('call:screen', { to: key, on: true });
          setStatus('connected');
        } else if (st === 'disconnected') {
          // Transient blip — surface "reconnecting" (primary leg only) and let ICE
          // recover; nudge an ICE restart if it's still down shortly after.
          if (connectedAtRef.current && isPrimaryLeg()) setStatus('reconnecting');
          const t = setTimeout(() => {
            if (peersRef.current.get(key)?.connectionState === 'disconnected') attemptIceRestart(key);
          }, 2500);
          timersRef.current.push(t);
        } else if (st === 'failed') {
          const attempts = restartRef.current.get(key) || 0;
          const dropLeg = () => {
            const p = peersRef.current.get(key);
            // Bail if it recovered in the meantime.
            if (p && p.connectionState !== 'failed' && p.connectionState !== 'disconnected') return;
            const wasPrimary = isPrimaryLeg();
            closePeer(key);
            if (peersRef.current.size === 0 && (connectedAtRef.current || wasPrimary)) teardown('ended');
          };
          // Only try to recover a leg that HAD connected (real reconnection).
          // The initiator drives the ICE restart; the answerer just holds the leg
          // open so that restart can land. A never-connected leg drops at once.
          if (connectedAtRef.current && attempts < MAX_ICE_RESTARTS) {
            if (isPrimaryLeg()) setStatus('reconnecting');
            if (pc.__ccInitiator) attemptIceRestart(key);
            else restartRef.current.set(key, attempts + 1);
            timersRef.current.push(setTimeout(dropLeg, 7000)); // safety net
            return;
          }
          dropLeg();
        } else if (st === 'closed') {
          const wasPrimary = isPrimaryLeg();
          closePeer(key);
          if (peersRef.current.size === 0 && (connectedAtRef.current || wasPrimary)) teardown('ended');
        }
      };
      peersRef.current.set(key, pc);
      return pc;
    },
    [closePeer, teardown, upsertRemote, attemptIceRestart, peerId, emitSig]
  );

  const flushCandidates = useCallback(async (remoteId) => {
    const key = String(remoteId);
    const pc = peersRef.current.get(key);
    if (!pc?.remoteDescription) return;
    const buf = candBufRef.current.get(key) || [];
    for (const c of buf) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* noop */
      }
    }
    candBufRef.current.set(key, []);
  }, []);

  // ── OUTGOING (primary peer): media → create call record → ring; SDP offer is
  //    created only after the callee accepts. ─────────────────────────────────
  useEffect(() => {
    if (!call || call.direction !== 'outgoing') return undefined;
    if (call.peer?._id) participantsRef.current.set(String(call.peer._id), call.peer);
    let cancelled = false;
    (async () => {
      try {
        await getMedia();
        if (cancelled) return;

        // ── GROUP call: ring every other member and let the mesh form ──
        if (hasGroup) {
          const roster = rosterUsers();
          if (!roster.length) {
            // Nobody else in the group is reachable — show a short local preview.
            setStatus('calling');
            addTimer(() => setStatus('demo'), 1800);
            return;
          }
          setStatus('calling');
          const caller = { _id: me?._id, name: me?.name, avatar: me?.avatar };
          roster.forEach((u) => {
            participantsRef.current.set(u._id, u);
            emitSig('call:invite', { to: u._id, type: call.type, caller });
          });
          // If nobody has answered by the ring timeout, give up the whole call.
          addTimer(() => {
            if (connectedAtRef.current || peersRef.current.size > 0) return;
            roster.forEach((u) => emitSig('call:cancel', { to: u._id }));
            toast('No one answered.', { icon: '📵' });
            teardown('noanswer', { linger: 1600 });
          }, RING_TIMEOUT_MS);
          return;
        }

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
          if (statusRef.current === 'connected' || peersRef.current.get(peerId)?.connectionState === 'connected') return;
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
    if (call.peer?._id) participantsRef.current.set(String(call.peer._id), call.peer);
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
      if (hasGroup) {
        // Group: announce readiness to everyone; the mesh negotiates each leg.
        announceReady();
        setStatus('connecting');
        addTimer(() => {
          if (statusRef.current === 'connecting' && peersRef.current.size === 0) teardown('ended');
        }, CONNECT_TIMEOUT_MS);
      } else if (hasSocketPeer) {
        emitSig('call:accept', { to: peerId });
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
      if (hasGroup) rosterUsers().forEach((u) => emitSig('call:reject', { to: u._id }));
      else if (hasSocketPeer) emitSig('call:reject', { to: peerId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMedia, peerId, hasSocketPeer, hasGroup, announceReady, rosterUsers, emitSig, failMedia, teardown]);

  const reject = useCallback(() => {
    if (hasGroup) rosterUsers().forEach((u) => emitSig('call:reject', { to: u._id }));
    else if (hasSocketPeer) emitSig('call:reject', { to: peerId });
    teardown('ended');
  }, [peerId, hasSocketPeer, hasGroup, rosterUsers, emitSig, teardown]);

  const hangUp = useCallback(() => {
    if (hasSocketPeer || hasGroup) {
      // End every leg: the primary peer + everyone added/ringed + anyone connected.
      const ids = new Set(
        [peerId, ...participantsRef.current.keys(), ...peersRef.current.keys()].filter(Boolean)
      );
      ids.forEach((id) => {
        if (connectedAtRef.current) {
          emitSig('call:end', { to: id, duration: liveDuration() });
        } else if (call?.direction === 'outgoing') {
          emitSig('call:cancel', { to: id });
        } else {
          emitSig('call:end', { to: id });
        }
      });
    }
    teardown('ended');
  }, [peerId, hasSocketPeer, hasGroup, call, emitSig, teardown]);

  /** Ring extra contacts into this call (they connect to you, the host). */
  const addParticipants = useCallback(
    (users = []) => {
      if (!hasSocketPeer && !hasGroup) {
        toast('Group calling needs a live connection.');
        return;
      }
      const added = [];
      users.forEach((u) => {
        const id = u?._id ? String(u._id) : null;
        if (!id || id === String(me?._id) || peersRef.current.has(id) || legTimersRef.current.has(id)) return;
        participantsRef.current.set(id, u);
        emitSig('call:invite', {
          to: id,
          type: call.type,
          caller: { _id: me?._id, name: me?.name, avatar: me?.avatar },
        });
        const t = setTimeout(() => {
          legTimersRef.current.delete(id);
          if (!peersRef.current.has(id)) {
            toast(`${u.name || 'They'} didn't answer.`, { icon: '📵' });
          }
        }, RING_TIMEOUT_MS);
        legTimersRef.current.set(id, t);
        added.push(u);
      });
      if (added.length) {
        toast.success(`Ringing ${added.length} ${added.length === 1 ? 'person' : 'people'}…`);
      }
    },
    [hasSocketPeer, hasGroup, me, call, emitSig]
  );

  // ── Screen share (video calls): swap the outgoing video track on every leg ──
  const stopShare = useCallback(() => {
    const cam = cameraTrackRef.current || null;
    peersRef.current.forEach((pc, id) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(cam).catch(() => {});
      emitSig('call:screen', { to: id, on: false });
    });
    try {
      screenTrackRef.current?.stop();
    } catch {
      /* noop */
    }
    screenTrackRef.current = null;
    setScreenStream(null);
    setSharingScreen(false);
  }, [emitSig]);

  const toggleScreenShare = useCallback(async () => {
    if (!wantVideo) return;
    if (sharingScreen) {
      stopShare();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenTrackRef.current = track;
      peersRef.current.forEach((pc, id) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(track).catch(() => {});
        emitSig('call:screen', { to: id, on: true });
      });
      setScreenStream(display);
      setSharingScreen(true);
      track.onended = () => stopShare(); // user hit the browser's "Stop sharing"
    } catch (err) {
      if (err?.name !== 'NotAllowedError') toast.error('Could not start screen share.');
    }
  }, [wantVideo, sharingScreen, stopShare, emitSig]);

  // ── Signaling listeners ──
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const mine = (cid) => !cid || cid === callIdRef.current;
    const isPrimary = (id) => String(id) === String(peerId);
    const nameFor = (id) => participantsRef.current.get(String(id))?.name || call?.peer?.name || 'User';

    // A party is ready (accepted / said hello) → establish the leg to them.
    const onAccepted = async ({ from, callId: cid }) => {
      if (!mine(cid) || !localStreamRef.current) return;
      const remote = String(from || peerId);
      if (!remote || peersRef.current.has(remote)) return;

      // GROUP mesh: for each pair the LOWER user-id is the offerer (avoids glare).
      // If I'm not the offerer, re-greet them once so THEY offer to me — this also
      // fixes ordering (my earlier hello may have arrived before they were ready).
      if (isGroupCall) {
        if (!myId) return;
        if (myId < remote) {
          try {
            if (statusRef.current !== 'connected') setStatus('connecting');
            const pc = createPeer(remote, localStreamRef.current, true);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            emitSig('call:offer', { to: remote, offer });
          } catch {
            closePeer(remote);
          }
        } else if (!helloBackRef.current.has(remote)) {
          helloBackRef.current.add(remote);
          emitSig('call:accept', { to: remote });
        }
        return;
      }

      try {
        if (statusRef.current !== 'connected') setStatus('connecting');
        const pc = createPeer(remote, localStreamRef.current, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitSig('call:offer', { to: remote, offer });
      } catch {
        closePeer(remote);
        if (isPrimary(remote) && !connectedAtRef.current) teardown('error');
      }
    };

    // An offer arrived (we're the callee for this leg) → answer it.
    const onOffer = async ({ from, callId: cid, offer }) => {
      if (!mine(cid) || !offer || !localStreamRef.current) return;
      const remote = String(from || peerId);
      // An offer for an EXISTING peer is a renegotiation (e.g. the initiator's
      // ICE restart) — answer it on the same connection instead of bailing.
      try {
        const pc = peersRef.current.get(remote) || createPeer(remote, localStreamRef.current, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushCandidates(remote);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        emitSig('call:answer', { to: remote, answer });
      } catch {
        closePeer(remote);
        if (isPrimary(remote) && !connectedAtRef.current) teardown('error');
      }
    };

    const onAnswer = async ({ from, callId: cid, answer }) => {
      const remote = String(from || peerId);
      const pc = peersRef.current.get(remote);
      if (!mine(cid) || !pc || !answer) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushCandidates(remote);
      } catch {
        /* noop */
      }
    };

    const onCandidate = async ({ from, callId: cid, candidate }) => {
      if (!mine(cid) || !candidate) return;
      const remote = String(from || peerId);
      const c = new RTCIceCandidate(candidate);
      const pc = peersRef.current.get(remote);
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* noop */
        }
      } else {
        const buf = candBufRef.current.get(remote) || [];
        buf.push(c);
        candBufRef.current.set(remote, buf);
      }
    };

    const onRejected = ({ from, callId: cid }) => {
      if (!mine(cid)) return;
      const remote = String(from || peerId);
      if (isPrimary(remote) && !connectedAtRef.current) {
        toast(`${nameFor(remote)} declined the call.`, { icon: '🚫' });
        teardown('declined', { linger: 1600 });
      } else {
        toast(`${nameFor(remote)} declined.`, { icon: '🚫' });
        closePeer(remote);
      }
    };

    const onCancelled = ({ from, callId: cid }) => {
      if (!mine(cid) || connectedAtRef.current) return;
      const remote = String(from || peerId);
      if (isPrimary(remote)) {
        toast(`Missed ${call?.type === 'video' ? 'video ' : ''}call from ${nameFor(remote)}.`, { icon: '📵' });
        teardown('missed');
      } else {
        closePeer(remote);
      }
    };

    const onUnavailable = ({ to, from, callId: cid }) => {
      if (!mine(cid)) return;
      const remote = String(to || from || peerId);
      if (isPrimary(remote)) {
        toast(`${nameFor(remote)} is offline.`, { icon: '📴' });
        teardown('unavailable', { linger: 1600 });
      } else {
        toast(`${nameFor(remote)} is offline.`, { icon: '📴' });
        closePeer(remote);
      }
    };

    const onEnded = ({ from, callId: cid }) => {
      if (!mine(cid)) return;
      const remote = String(from || peerId);
      if (peersRef.current.has(remote)) {
        closePeer(remote);
        if (peersRef.current.size === 0) teardown('ended');
      } else if (isPrimary(remote)) {
        teardown('ended');
      }
    };

    // Another of MY tabs/devices already accepted or rejected this call.
    const onHandled = ({ callId: cid }) => {
      if (mine(cid) && statusRef.current === 'incoming') teardown('ended');
    };

    // The person we're ringing is on another call / in a meeting.
    const onBusy = ({ from, callId: cid }) => {
      if (!mine(cid) || connectedAtRef.current) return;
      const remote = String(from || peerId);
      if (isPrimary(remote)) {
        toast(`${nameFor(remote)} is busy on another call.`, { icon: '⏳' });
        teardown('busy', { linger: 2000 });
      } else {
        toast(`${nameFor(remote)} is busy on another call.`, { icon: '⏳' });
        closePeer(remote);
      }
    };

    // A remote party started/stopped presenting their screen.
    const onScreen = ({ from, callId: cid, on }) => {
      if (!mine(cid)) return;
      const remote = String(from || peerId);
      setRemotePresenters((prev) => (on ? [...prev.filter((id) => id !== remote), remote] : prev.filter((id) => id !== remote)));
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
    s.on('call:busy', onBusy);
    s.on('call:screen', onScreen);
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
      s.off('call:busy', onBusy);
      s.off('call:screen', onScreen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPeer, flushCandidates, closePeer, teardown, peerId, emitSig, isGroupCall, myId]);

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

  // Live-toggle browser noise suppression / echo cancellation / auto-gain on the
  // mic track. Reflects the setting the track actually reports back (some
  // browsers silently ignore the constraint), and no-ops gracefully otherwise.
  const toggleNoiseCancel = useCallback(async () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const next = !noiseCancel;
    try {
      await track.applyConstraints({
        echoCancellation: next,
        noiseSuppression: next,
        autoGainControl: next,
      });
      const applied = track.getSettings?.().noiseSuppression;
      const on = typeof applied === 'boolean' ? applied : next;
      setNoiseCancel(on);
      toast.success(on ? 'Noise cancellation on' : 'Noise cancellation off');
    } catch {
      toast.error('This browser can’t change noise cancellation.');
    }
  }, [noiseCancel]);

  return {
    localStream,
    screenStream,
    remoteStreams,
    remotePresenters,
    status,
    muted,
    camOff,
    sharingScreen,
    noiseCancel,
    mediaError,
    accept,
    reject,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    toggleNoiseCancel,
    addParticipants,
  };
}
