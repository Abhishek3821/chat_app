import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  MonitorUp,
  MonitorX,
  UserPlus,
  PhoneOff,
  Phone,
  Maximize2,
  Minimize2,
  MessageSquare,
  AlertTriangle,
  Users,
  X,
  Check,
  Search,
} from 'lucide-react';
import Avatar from '../ui/Avatar';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useContacts } from '../../store/useContacts';
import { useWebRTC } from '../../hooks/useWebRTC';
import { formatDuration, cn } from '../../lib/utils';

export default function CallOverlay() {
  const call = useUI((s) => s.call);
  if (!call) return null;
  // Key by callId/peer so the WebRTC hook fully re-initialises per call.
  return <CallSession key={call.callId || call.peer?._id || 'call'} call={call} />;
}

/** A <video> that owns its element and (re)attaches the stream on remount. */
function StreamVideo({ stream, mirror, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={cn(mirror && '-scale-x-100', className)} />;
}

/** Hidden audio sink — kept mounted even when minimized so sound never cuts. */
function RemoteAudio({ stream, sinkId }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (el && sinkId && typeof el.setSinkId === 'function') el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, stream]);
  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

function CallSession({ call }) {
  const {
    localStream,
    screenStream,
    remoteStreams,
    status,
    muted,
    camOff,
    sharingScreen,
    mediaError,
    accept,
    reject,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    addParticipants,
  } = useWebRTC(call);

  const minimized = useUI((s) => Boolean(s.call?.minimized));
  const minimizeCall = useUI((s) => s.minimizeCall);
  const restoreCall = useUI((s) => s.restoreCall);
  const openDirectChat = useChat((s) => s.openDirectChat);
  const setActiveChat = useChat((s) => s.setActiveChat);
  const navigate = useNavigate();

  const [seconds, setSeconds] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const [sinkId, setSinkId] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const rootRef = useRef(null);

  const isVideo = call.type === 'video';
  const peer = call.peer || {};
  const connected = status === 'connected' || status === 'demo';
  const incoming = status === 'incoming';
  const remotes = remoteStreams || [];
  const nRemote = remotes.length;
  const selfPreview = sharingScreen ? screenStream : localStream;

  // Duration timer once connected.
  useEffect(() => {
    if (!connected) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  // Track real fullscreen state (Esc, browser chrome, etc.).
  useEffect(() => {
    const h = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const statusText = incoming
    ? `Incoming ${isVideo ? 'video ' : ''}call…`
    : status === 'calling'
    ? 'Ringing…'
    : status === 'connecting'
    ? 'Connecting…'
    : status === 'declined'
    ? 'Call declined'
    : status === 'noanswer'
    ? 'No answer'
    : status === 'unavailable'
    ? 'User is offline'
    : status === 'missed'
    ? 'Missed call'
    : status === 'error'
    ? 'Call failed'
    : connected
    ? formatDuration(seconds)
    : 'Calling…';

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen();
      else toast('Fullscreen isn’t supported here.');
    } catch {
      toast.error('Couldn’t toggle fullscreen.');
    }
  };

  // "Speaker" = choose which audio output device plays the call (real on Chromium).
  const cycleSpeaker = async () => {
    const canSink = typeof document !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
    if (!canSink) {
      toast('This browser can’t switch audio output.');
      return;
    }
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      if (devs.length < 2) {
        toast('No other speaker/output found.');
        return;
      }
      const idx = devs.findIndex((d) => d.deviceId === sinkId);
      const nextIdx = (idx + 1) % devs.length;
      const next = devs[nextIdx];
      setSinkId(next.deviceId);
      toast.success(`Speaker: ${next.label || `Output ${nextIdx + 1}`}`);
    } catch {
      toast.error('Couldn’t switch audio output.');
    }
  };

  const openChat = async () => {
    minimizeCall();
    try {
      if (call.group?._id) setActiveChat(call.group._id);
      else if (peer._id) await openDirectChat(peer._id);
    } catch {
      /* ignore — we still navigate to the chat home */
    }
    navigate('/');
  };

  const excludeIds = useMemo(
    () => [peer._id, ...remotes.map((r) => r.id)].filter(Boolean).map(String),
    [peer._id, remotes]
  );

  // ── Minimized: keep media alive, show a compact floating pill ──
  if (minimized) {
    return (
      <>
        <div className="hidden">
          {remotes.map((r) => (
            <RemoteAudio key={r.id} stream={r.stream} sinkId={sinkId} />
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 right-4 z-[120] flex items-center gap-3 rounded-2xl bg-navy-900/95 p-2.5 pr-3 shadow-soft-lg ring-1 ring-white/10 backdrop-blur-xl"
        >
          <button onClick={restoreCall} className="flex items-center gap-3" title="Return to call">
            <div className="relative">
              <Avatar src={peer.avatar} name={peer.name} size="sm" />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 ring-2 ring-navy-900">
                {isVideo ? <Video size={9} className="text-white" /> : <Phone size={9} className="text-white" />}
              </span>
            </div>
            <div className="text-left">
              <p className="max-w-[120px] truncate text-sm font-semibold text-white">{peer.name || 'Call'}</p>
              <p className="text-xs text-emerald-400">{connected ? formatDuration(seconds) : statusText}</p>
            </div>
          </button>
          <div className="flex items-center gap-1.5">
            <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} className={cn('grid h-9 w-9 place-items-center rounded-full', muted ? 'bg-white text-navy-900' : 'bg-white/15 text-white hover:bg-white/25')}>
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button onClick={restoreCall} title="Expand" className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <Maximize2 size={15} />
            </button>
            <button onClick={hangUp} title="End call" className="grid h-9 w-9 place-items-center rounded-full bg-red-500 text-white hover:bg-red-600">
              <PhoneOff size={16} />
            </button>
          </div>
        </motion.div>
      </>
    );
  }

  return (
    <motion.div ref={rootRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[120] overflow-hidden">
      {/* Blurred gradient background */}
      <div className="absolute inset-0 bg-navy-950" />
      <div className="absolute inset-0 bg-brand-gradient opacity-30 blur-[100px]" />
      <div className="absolute inset-0 opacity-40 blur-3xl" style={{ backgroundImage: peer.avatar ? `url(${peer.avatar})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-2xl" />

      {/* Always-mounted remote audio sinks */}
      <div className="hidden">
        {remotes.map((r) => (
          <RemoteAudio key={r.id} stream={r.stream} sinkId={sinkId} />
        ))}
      </div>

      <div className="relative flex h-full flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-5 text-white">
          <div>
            <p className="text-sm font-medium text-white/70">
              {isVideo ? 'Video call' : 'Voice call'}
              {nRemote >= 1 && connected ? ` · You + ${nRemote}` : ''}
            </p>
            <p className="text-lg font-bold">{peer.name || 'Unknown'}</p>
          </div>
          {!incoming && (
            <div className="flex items-center gap-2">
              <button onClick={minimizeCall} title="Minimize" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20">
                <Minimize2 size={18} />
              </button>
              <button onClick={toggleFullscreen} title={isFs ? 'Exit fullscreen' : 'Fullscreen'} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20">
                {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          )}
        </div>

        {/* Stage */}
        <div className="relative flex flex-1 items-center justify-center px-6 pb-2">
          {status === 'error' ? (
            <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/20 text-red-300"><AlertTriangle size={28} /></span>
              <p className="text-lg font-bold">Couldn’t start the call</p>
              <p className="text-sm text-white/70">{mediaError}</p>
              <p className="text-xs text-white/50">Tip: camera/mic need https or localhost, and browser permission.</p>
            </div>
          ) : nRemote === 0 ? (
            isVideo && selfPreview && !camOff && !incoming ? (
              <div className="relative">
                <StreamVideo stream={selfPreview} mirror={!sharingScreen} className="h-full max-h-[72vh] w-full max-w-4xl rounded-3xl border border-white/10 object-cover" />
                <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-navy-950/60 px-3 py-1 text-xs text-white/80 backdrop-blur">
                  {connected ? 'You (waiting for the other person…)' : sharingScreen ? 'Presenting your screen' : 'Your camera'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="relative">
                  {(incoming || status === 'calling') && (
                    <>
                      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-500/40" />
                      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-cyan-500/30" style={{ animationDelay: '0.6s' }} />
                    </>
                  )}
                  <Avatar src={peer.avatar} name={peer.name} size="2xl" className="relative scale-[1.6]" />
                </div>
                <div className="mt-6 text-center text-white">
                  <h2 className="text-2xl font-bold">{peer.name || 'Unknown'}</h2>
                  <motion.p key={statusText} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 text-white/70">{statusText}</motion.p>
                </div>
              </div>
            )
          ) : !isVideo ? (
            // ── Audio, connected ──
            nRemote === 1 ? (
              <div className="flex flex-col items-center gap-6">
                <Avatar src={remotes[0].user?.avatar || peer.avatar} name={remotes[0].user?.name || peer.name} size="2xl" className="scale-[1.6]" />
                <div className="mt-6 text-center text-white">
                  <h2 className="text-2xl font-bold">{remotes[0].user?.name || peer.name || 'Unknown'}</h2>
                  <p className="mt-1 text-white/70">{formatDuration(seconds)}</p>
                </div>
              </div>
            ) : (
              <div className="grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3">
                {remotes.map((r) => (
                  <div key={r.id} className="flex flex-col items-center gap-2 rounded-2xl bg-white/5 p-4">
                    <Avatar src={r.user?.avatar} name={r.user?.name} size="xl" />
                    <span className="max-w-[120px] truncate text-sm font-medium text-white/90">{r.user?.name || 'Guest'}</span>
                  </div>
                ))}
              </div>
            )
          ) : nRemote === 1 ? (
            // ── Video 1:1 — remote big, local PiP ──
            <>
              <StreamVideo stream={remotes[0].stream} className="h-full max-h-[72vh] w-full max-w-4xl rounded-3xl border border-white/10 object-cover" />
              <div className="absolute bottom-4 right-4 h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-navy-900 shadow-soft-lg sm:h-48 sm:w-36">
                {camOff && !sharingScreen ? (
                  <div className="grid h-full place-items-center text-white/60"><VideoOff size={20} /></div>
                ) : (
                  <StreamVideo stream={selfPreview} mirror={!sharingScreen} className="h-full w-full object-cover" />
                )}
              </div>
            </>
          ) : (
            // ── Video group — grid of remotes + self ──
            <div className={cn('grid w-full max-w-5xl gap-3', nRemote >= 3 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2')}>
              {remotes.map((r) => (
                <div key={r.id} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-navy-900">
                  <StreamVideo stream={r.stream} className="h-full w-full object-cover" />
                  <span className="absolute bottom-2 left-2 rounded-full bg-navy-950/60 px-2 py-0.5 text-xs text-white/80 backdrop-blur">{r.user?.name || 'Guest'}</span>
                </div>
              ))}
              <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/20 bg-navy-900">
                {camOff && !sharingScreen ? (
                  <div className="grid h-full place-items-center text-white/60"><VideoOff size={22} /></div>
                ) : (
                  <StreamVideo stream={selfPreview} mirror={!sharingScreen} className="h-full w-full object-cover" />
                )}
                <span className="absolute bottom-2 left-2 rounded-full bg-navy-950/60 px-2 py-0.5 text-xs text-white/80 backdrop-blur">You{sharingScreen ? ' · presenting' : ''}</span>
              </div>
            </div>
          )}

          {/* Add-people picker */}
          {showAdd && (
            <AddPeoplePanel
              excludeIds={excludeIds}
              onClose={() => setShowAdd(false)}
              onAdd={(users) => {
                addParticipants(users);
                setShowAdd(false);
              }}
            />
          )}
        </div>

        {/* Controls */}
        <div className="flex justify-center pb-10 pt-4">
          {incoming ? (
            <div className="flex items-center gap-10">
              <button onClick={reject} className="flex flex-col items-center gap-2">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105"><PhoneOff size={24} /></span>
                <span className="text-xs font-medium text-white/80">Decline</span>
              </button>
              <button onClick={accept} className="flex flex-col items-center gap-2">
                <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg">
                  {isVideo ? <Video size={24} /> : <Phone size={24} />}
                </motion.span>
                <span className="text-xs font-medium text-white/80">Accept</span>
              </button>
            </div>
          ) : (
            <div className="glass-strong flex items-center gap-2 rounded-full p-2.5 shadow-soft-lg sm:gap-3">
              <CtrlBtn active={!muted} onClick={toggleMute} icon={muted ? MicOff : Mic} label={muted ? 'Unmute' : 'Mute'} />
              {isVideo && <CtrlBtn active={!camOff} onClick={toggleCamera} icon={camOff ? VideoOff : Video} label={camOff ? 'Camera on' : 'Camera off'} />}
              <CtrlBtn onClick={cycleSpeaker} icon={Volume2} label="Speaker" />
              {isVideo && (
                <CtrlBtn
                  active={!sharingScreen}
                  onClick={toggleScreenShare}
                  icon={sharingScreen ? MonitorX : MonitorUp}
                  label={sharingScreen ? 'Stop presenting' : 'Present screen'}
                  className="hidden sm:grid"
                />
              )}
              {isVideo && <CtrlBtn active={!showAdd} onClick={() => setShowAdd((v) => !v)} icon={UserPlus} label="Add people" className="hidden sm:grid" />}
              <CtrlBtn onClick={openChat} icon={MessageSquare} label="Chat" className="hidden sm:grid" />
              <button onClick={hangUp} title="End call" className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95">
                <PhoneOff size={22} />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function CtrlBtn({ icon: Icon, label, onClick, active = true, className }) {
  return (
    <button onClick={onClick} title={label} className={cn('grid h-12 w-12 place-items-center rounded-full transition-all hover:scale-105 active:scale-95', active ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-navy-900', className)}>
      <Icon size={20} />
    </button>
  );
}

/** Contact picker to ring extra people into the call. */
function AddPeoplePanel({ excludeIds = [], onClose, onAdd }) {
  const contacts = useContacts((s) => s.contacts);
  const load = useContacts((s) => s.load);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    if (!contacts.length) load();
  }, [contacts.length, load]);

  const available = useMemo(
    () =>
      contacts
        .filter((c) => !excludeIds.includes(String(c._id)))
        .filter((c) => !q || (c.name || '').toLowerCase().includes(q.toLowerCase()) || (c.username || '').toLowerCase().includes(q.toLowerCase())),
    [contacts, excludeIds, q]
  );

  const toggle = (c) =>
    setSelected((prev) => (prev.some((u) => u._id === c._id) ? prev.filter((u) => u._id !== c._id) : [...prev, c]));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="absolute bottom-4 left-1/2 z-10 w-[min(92vw,22rem)] -translate-x-1/2 overflow-hidden rounded-3xl bg-navy-900/95 shadow-soft-lg ring-1 ring-white/10 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Users size={17} className="text-brand-400" />
          <span className="font-semibold">Add people</span>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10"><X size={16} /></button>
      </div>
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-white/80">
          <Search size={15} className="text-white/50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="w-full bg-transparent text-sm outline-none placeholder:text-white/40" />
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto p-2">
        {available.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-white/50">No contacts to add.</p>
        ) : (
          available.map((c) => {
            const on = selected.some((u) => u._id === c._id);
            return (
              <button
                key={c._id}
                onClick={() => toggle(c)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', on ? 'bg-brand-500/20' : 'hover:bg-white/5')}
              >
                <Avatar src={c.avatar} name={c.name} size="sm" online={c.isOnline} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{c.name}</span>
                <span className={cn('grid h-5 w-5 place-items-center rounded-full border', on ? 'border-brand-400 bg-brand-500 text-white' : 'border-white/30 text-transparent')}>
                  <Check size={13} />
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="border-t border-white/10 p-3">
        <button
          disabled={!selected.length}
          onClick={() => onAdd(selected)}
          className={cn('w-full rounded-xl py-2.5 text-sm font-semibold transition-colors', selected.length ? 'bg-brand-500 text-white hover:bg-brand-600' : 'cursor-not-allowed bg-white/10 text-white/40')}
        >
          {selected.length ? `Ring ${selected.length} ${selected.length === 1 ? 'person' : 'people'}` : 'Select people to add'}
        </button>
      </div>
    </motion.div>
  );
}
