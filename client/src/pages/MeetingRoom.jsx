import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, Copy, Users, Loader2, AlertTriangle, Disc, Hourglass, RectangleHorizontal, RectangleVertical } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { useSocket } from '@/hooks/useSocket';
import { useMeetingRoom } from '@/hooks/useMeetingRoom';
import { useMeetings } from '@/store/useMeetings';
import { useAuth } from '@/store/useAuth';
import { useUI } from '@/store/useUI';
import { cn } from '@/lib/utils';

/** Attaches a MediaStream to a <video> element. */
function VideoTile({ stream, name, avatar, muted = false, mirror = false, label, fit = 'cover', className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-navy-950/80 shadow-soft', fit === 'contain' && 'bg-black', className)}>
      <video ref={ref} autoPlay playsInline muted={muted} className={cn('h-full w-full', fit === 'contain' ? 'object-contain' : 'object-cover', mirror && 'scale-x-[-1]', !hasVideo && 'invisible')} />
      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar src={avatar} name={name} size="xl" />
        </div>
      )}
      {label && (
        <span className="absolute bottom-2 left-2 rounded-lg bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{label}</span>
      )}
    </div>
  );
}

export default function MeetingRoom() {
  const { code } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { getByCode, joinByCode } = useMeetings();
  useSocket(); // ensure the socket is live even when opened directly from a shared link

  const [phase, setPhase] = useState('loading'); // loading | ready | notfound
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');

  // While in the meeting, incoming calls answer "busy" + show a side banner.
  const setInMeeting = useUI((s) => s.setInMeeting);
  useEffect(() => {
    setInMeeting(true);
    return () => setInMeeting(false);
  }, [setInMeeting]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getByCode(code); // validate the link exists / isn't cancelled
        const joined = await joinByCode(code); // register + get the room id
        if (cancelled) return;
        setMeeting(joined);
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'This meeting link is invalid or has expired.');
        setPhase('notfound');
      }
    })();
    return () => { cancelled = true; };
  }, [code, getByCode, joinByCode]);

  if (phase === 'loading') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-navy-950 text-white">
        <div className="flex flex-col items-center gap-3"><Loader2 className="animate-spin" size={28} /><p className="text-sm text-white/70">Joining meeting…</p></div>
      </div>
    );
  }
  if (phase === 'notfound') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-navy-950 p-6 text-center text-white">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-400"><AlertTriangle size={26} /></span>
          <h1 className="text-lg font-bold">Can’t join this meeting</h1>
          <p className="text-sm text-white/70">{error}</p>
          <Button variant="glass" onClick={() => navigate('/meetings')}>Back to meetings</Button>
        </div>
      </div>
    );
  }

  return <Room meeting={meeting} code={code} me={me} onLeave={() => navigate('/meetings')} />;
}

function Room({ meeting, code, me, onLeave }) {
  const isHost = String(meeting.host?._id || meeting.host) === String(me?._id);
  const room = useMeetingRoom(meeting._id, {
    video: meeting.type !== 'audio',
    muteOnEntry: meeting.settings?.muteOnEntry,
    autoRecord: meeting.settings?.autoRecord,
    isHost,
  });
  const { localStream, screenStream, remotes, presenterSid, status, muted, camOff, sharingScreen, recording, mediaError, toggleMute, toggleCamera, toggleScreenShare, toggleRecording, leave } = room;
  const [portrait, setPortrait] = useState(false); // tile orientation option

  useEffect(() => { if (status === 'left') onLeave(); }, [status, onLeave]);

  const doLeave = () => { leave(); onLeave(); };
  const copyId = () => {
    navigator.clipboard?.writeText(code).then(() => toast.success('Meeting ID copied.')).catch(() => toast(code));
  };
  const copyLink = () => {
    const url = `${window.location.origin}/meet/${code}`;
    navigator.clipboard?.writeText(url).then(() => toast.success('Meeting link copied — share it with anyone.')).catch(() => toast(url));
  };

  // "Join anytime" is off and the host hasn't arrived — hold in a lobby.
  if (status === 'waiting') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-navy-950 p-6 text-center text-white">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10"><Hourglass size={24} className="animate-pulse" /></span>
          <h1 className="text-lg font-bold">Waiting for the host</h1>
          <p className="text-sm text-white/70">{mediaError || 'The meeting will start once the host joins.'}</p>
          <p className="text-xs text-white/50">Meeting ID <span className="font-mono">{code}</span></p>
          <Button variant="glass" onClick={doLeave}>Leave</Button>
        </div>
      </div>
    );
  }

  const total = remotes.length + 1;
  const cols = total <= 1 ? 'grid-cols-1' : total <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3';
  const tileAspect = portrait ? 'aspect-[3/4] max-h-full' : '';

  // Spotlight: whoever is presenting a screen (you or a remote peer) fills the
  // stage (object-contain so nothing is cropped) with everyone else in a strip.
  const presenting = Boolean(presenterSid);
  const presenterIsMe = presenterSid === 'me';
  const presenterRemote = !presenterIsMe ? remotes.find((r) => r.socketId === presenterSid) : null;
  const presenterStream = presenterIsMe ? screenStream : presenterRemote?.stream;
  const presenterName = presenterIsMe ? 'You' : presenterRemote?.user?.name || 'Guest';

  return (
    <div className="flex h-[100dvh] flex-col bg-navy-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{meeting.title}</p>
          <button onClick={copyId} title="Copy meeting ID" className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/90">
            <Users size={12} /> {total} in call · Meeting ID <span className="font-mono">{code}</span> <Copy size={11} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {recording && <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-300"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> REC</span>}
          <Button variant="glass" size="sm" onClick={copyLink}><Copy size={14} /> Copy link</Button>
        </div>
      </header>

      {mediaError && (
        <div className="mx-4 mb-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">{mediaError}</div>
      )}

      {/* Presenting banner — you always SEE what you're sharing (like Google Meet) */}
      {sharingScreen && (
        <div className="mx-auto mb-2 flex items-center gap-3 rounded-full bg-emerald-500/15 px-4 py-1.5 text-sm text-emerald-200 ring-1 ring-emerald-500/30">
          <MonitorUp size={15} />
          <span className="font-medium">You’re presenting to everyone</span>
          <button onClick={toggleScreenShare} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600">Stop presenting</button>
        </div>
      )}
      {!sharingScreen && presenting && presenterRemote && (
        <div className="mx-auto mb-2 flex items-center gap-2 rounded-full bg-cyan-500/15 px-4 py-1.5 text-sm text-cyan-200 ring-1 ring-cyan-500/30">
          <MonitorUp size={15} />
          <span className="font-medium">{presenterName} is presenting</span>
        </div>
      )}

      <div className="min-h-0 flex-1 px-4">
        {presenting && presenterStream ? (
          <div className="flex h-full flex-col gap-3">
            <VideoTile stream={presenterStream} name={presenterName} muted={presenterIsMe} fit="contain" label={presenterIsMe ? 'Your shared screen' : `${presenterName}’s screen`} className="min-h-0 flex-1" />
            <div className="flex justify-center gap-2 overflow-x-auto pb-2">
              <VideoTile stream={localStream} name={me?.name} avatar={me?.avatar} muted mirror label={`${me?.name || 'You'} (you)`} className="h-24 w-36 shrink-0" />
              {remotes.filter((r) => r.socketId !== presenterSid).map((r) => (
                <VideoTile key={r.socketId} stream={r.stream} name={r.user?.name} avatar={r.user?.avatar} label={r.user?.name || 'Guest'} className="h-24 w-36 shrink-0" />
              ))}
            </div>
          </div>
        ) : (
          <div className={cn('grid h-full gap-3 place-content-center', cols, portrait && 'place-items-center')}>
            <VideoTile stream={localStream} name={me?.name} avatar={me?.avatar} muted mirror label={`${me?.name || 'You'} (you)${muted ? ' · muted' : ''}`} className={tileAspect} />
            {remotes.map((r) => (
              <VideoTile key={r.socketId} stream={r.stream} name={r.user?.name} avatar={r.user?.avatar} label={r.user?.name || 'Guest'} className={tileAspect} />
            ))}
          </div>
        )}
        {remotes.length === 0 && !presenting && (
          <p className="mt-3 text-center text-sm text-white/50">
            {status === 'connecting' ? 'Connecting…' : 'You’re the only one here. Share the meeting ID or link to invite others.'}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-center gap-3 px-4 py-5">
        <CtrlButton active={!muted} onClick={toggleMute} on={<Mic size={20} />} off={<MicOff size={20} />} label={muted ? 'Unmute' : 'Mute'} />
        {meeting.type !== 'audio' && (
          <CtrlButton active={!camOff} onClick={toggleCamera} on={<Video size={20} />} off={<VideoOff size={20} />} label={camOff ? 'Start video' : 'Stop video'} />
        )}
        {meeting.type !== 'audio' && (
          <CtrlButton active={sharingScreen} onClick={toggleScreenShare} on={<MonitorX size={20} />} off={<MonitorUp size={20} />} label={sharingScreen ? 'Stop presenting' : 'Share screen'} highlightWhenActive />
        )}
        {meeting.type !== 'audio' && (
          <CtrlButton
            active={portrait}
            onClick={() => setPortrait((v) => !v)}
            on={<RectangleVertical size={20} />}
            off={<RectangleHorizontal size={20} />}
            label={portrait ? 'Switch to landscape tiles' : 'Switch to portrait tiles'}
          />
        )}
        <CtrlButton active={recording} onClick={toggleRecording} on={<Disc size={20} />} off={<Disc size={20} />} label={recording ? 'Stop recording' : 'Record'} highlightWhenActive />
        <button onClick={doLeave} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white transition-transform hover:scale-105" title="Leave">
          <PhoneOff size={22} />
        </button>
      </footer>
    </div>
  );
}

function CtrlButton({ active, onClick, on, off, label, highlightWhenActive = false }) {
  const highlighted = highlightWhenActive ? active : !active;
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'grid h-14 w-14 place-items-center rounded-full transition-colors',
        highlighted ? 'bg-white text-navy-950' : 'bg-white/10 text-white hover:bg-white/20'
      )}
    >
      {active ? on : off}
    </button>
  );
}
