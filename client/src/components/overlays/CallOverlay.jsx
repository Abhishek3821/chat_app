import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, Video, VideoOff, Volume2, MonitorUp, UserPlus, PhoneOff, Phone, Maximize2, MessageSquare, AlertTriangle } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { useUI } from '../../store/useUI';
import { useWebRTC } from '../../hooks/useWebRTC';
import { formatDuration, cn } from '../../lib/utils';

export default function CallOverlay() {
  const call = useUI((s) => s.call);
  if (!call) return null;
  // Key by callId/peer so the WebRTC hook fully re-initialises per call.
  return <CallSession key={call.callId || call.peer?._id || 'call'} call={call} />;
}

function CallSession({ call }) {
  const { localStream, remoteStream, status, muted, camOff, mediaError, accept, reject, hangUp, toggleMute, toggleCamera } =
    useWebRTC(call);

  const [seconds, setSeconds] = useState(0);
  const localRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const isVideo = call.type === 'video';
  const peer = call.peer || {};
  const connected = status === 'connected' || status === 'demo';
  const incoming = status === 'incoming';

  // Attach streams to media elements.
  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current && remoteStream) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // Duration timer once connected.
  useEffect(() => {
    if (!connected) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

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

  const showRemoteVideo = isVideo && remoteStream;
  const showLocalAsMain = isVideo && !remoteStream && localStream && !camOff;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] overflow-hidden">
        {/* Blurred gradient background */}
        <div className="absolute inset-0 bg-navy-950" />
        <div className="absolute inset-0 bg-brand-gradient opacity-30 blur-[100px]" />
        <div className="absolute inset-0 opacity-40 blur-3xl" style={{ backgroundImage: peer.avatar ? `url(${peer.avatar})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-2xl" />

        {/* Hidden audio sink so remote audio plays on voice calls */}
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        <div className="relative flex h-full flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between p-5 text-white">
            <div>
              <p className="text-sm font-medium text-white/70">{isVideo ? 'Video call' : 'Voice call'}</p>
              <p className="text-lg font-bold">{peer.name || 'Unknown'}</p>
            </div>
            <button className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20"><Maximize2 size={18} /></button>
          </div>

          {/* Stage */}
          <div className="relative flex flex-1 items-center justify-center px-6">
            {showRemoteVideo ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="h-full max-h-[72vh] w-full max-w-4xl rounded-3xl border border-white/10 object-cover" />
            ) : showLocalAsMain ? (
              <div className="relative">
                <video ref={localRef} autoPlay playsInline muted className="h-full max-h-[72vh] w-full max-w-4xl -scale-x-100 rounded-3xl border border-white/10 object-cover" />
                <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-navy-950/60 px-3 py-1 text-xs text-white/80 backdrop-blur">
                  {connected && !remoteStream ? 'You (waiting for the other person…)' : 'Your camera'}
                </span>
              </div>
            ) : status === 'error' ? (
              <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/20 text-red-300"><AlertTriangle size={28} /></span>
                <p className="text-lg font-bold">Couldn’t start the call</p>
                <p className="text-sm text-white/70">{mediaError}</p>
                <p className="text-xs text-white/50">Tip: camera/mic need https or localhost, and browser permission.</p>
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
            )}

            {/* Local self-view PiP (when remote video is showing) */}
            {isVideo && remoteStream && (
              <div className="absolute bottom-4 right-4 h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-navy-900 shadow-soft-lg sm:h-48 sm:w-36">
                {camOff ? (
                  <div className="grid h-full place-items-center text-white/60"><VideoOff size={20} /></div>
                ) : (
                  <video ref={localRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
                )}
              </div>
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
                {isVideo && <CtrlBtn active={!camOff} onClick={toggleCamera} icon={camOff ? VideoOff : Video} label="Camera" />}
                <CtrlBtn icon={Volume2} label="Speaker" />
                <CtrlBtn icon={MonitorUp} label="Share" className="hidden sm:grid" />
                <CtrlBtn icon={UserPlus} label="Add" className="hidden sm:grid" />
                <CtrlBtn icon={MessageSquare} label="Chat" className="hidden sm:grid" />
                <button onClick={hangUp} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95">
                  <PhoneOff size={22} />
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function CtrlBtn({ icon: Icon, label, onClick, active = true, className }) {
  return (
    <button onClick={onClick} title={label} className={cn('grid h-12 w-12 place-items-center rounded-full transition-all hover:scale-105 active:scale-95', active ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-navy-900', className)}>
      <Icon size={20} />
    </button>
  );
}
