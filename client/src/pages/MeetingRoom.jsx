import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Copy, Users, Loader2, AlertTriangle } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { useSocket } from '@/hooks/useSocket';
import { useMeetingRoom } from '@/hooks/useMeetingRoom';
import { useMeetings } from '@/store/useMeetings';
import { useAuth } from '@/store/useAuth';
import { cn } from '@/lib/utils';

/** Attaches a MediaStream to a <video> element. */
function VideoTile({ stream, name, avatar, muted = false, mirror = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  return (
    <div className="relative overflow-hidden rounded-2xl bg-navy-950/80 shadow-soft">
      <video ref={ref} autoPlay playsInline muted={muted} className={cn('h-full w-full object-cover', mirror && 'scale-x-[-1]', !hasVideo && 'invisible')} />
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
  const room = useMeetingRoom(meeting._id, { video: meeting.type !== 'audio' });
  const { localStream, remotes, status, muted, camOff, sharingScreen, mediaError, toggleMute, toggleCamera, toggleScreenShare, leave } = room;

  useEffect(() => { if (status === 'left') onLeave(); }, [status, onLeave]);

  const doLeave = () => { leave(); onLeave(); };
  const copyLink = () => {
    const url = `${window.location.origin}/meet/${code}`;
    navigator.clipboard?.writeText(url).then(() => toast.success('Meeting link copied — share it with anyone.')).catch(() => toast(url));
  };

  const total = remotes.length + 1;
  const cols = total <= 1 ? 'grid-cols-1' : total <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3';

  return (
    <div className="flex h-[100dvh] flex-col bg-navy-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{meeting.title}</p>
          <p className="flex items-center gap-1.5 text-xs text-white/60"><Users size={12} /> {total} in call · <span className="font-mono">{code}</span></p>
        </div>
        <Button variant="glass" size="sm" onClick={copyLink}><Copy size={14} /> Copy link</Button>
      </header>

      {mediaError && (
        <div className="mx-4 mb-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">{mediaError}</div>
      )}

      <div className="min-h-0 flex-1 px-4">
        <div className={cn('grid h-full gap-3 place-content-center', cols)}>
          <VideoTile stream={localStream} name={me?.name} avatar={me?.avatar} muted mirror={!sharingScreen} label={`${me?.name || 'You'} (you)`} />
          {remotes.map((r) => (
            <VideoTile key={r.socketId} stream={r.stream} name={r.user?.name} avatar={r.user?.avatar} label={r.user?.name || 'Guest'} />
          ))}
        </div>
        {remotes.length === 0 && (
          <p className="mt-3 text-center text-sm text-white/50">
            {status === 'connecting' ? 'Connecting…' : 'You’re the only one here. Share the link to invite others.'}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-center gap-3 px-4 py-5">
        <CtrlButton active={!muted} onClick={toggleMute} on={<Mic size={20} />} off={<MicOff size={20} />} label={muted ? 'Unmute' : 'Mute'} />
        {meeting.type !== 'audio' && (
          <CtrlButton active={!camOff} onClick={toggleCamera} on={<Video size={20} />} off={<VideoOff size={20} />} label={camOff ? 'Start video' : 'Stop video'} />
        )}
        {meeting.type !== 'audio' && (
          <CtrlButton active={sharingScreen} onClick={toggleScreenShare} on={<MonitorUp size={20} />} off={<MonitorUp size={20} />} label="Share screen" highlightWhenActive />
        )}
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
