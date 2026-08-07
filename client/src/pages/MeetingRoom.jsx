import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, Copy, Users, Loader2, AlertTriangle, Disc, Hourglass, RectangleHorizontal, RectangleVertical, MessageSquare, Hand, Smile, Send, X, UserX, MicOff as MicOffIcon, ShieldCheck, Check, DoorOpen, BarChart3, Captions } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import MeetingPollsPanel from '@/components/meeting/MeetingPollsPanel';
import CaptionOverlay from '@/components/meeting/CaptionOverlay';
import { useSocket } from '@/hooks/useSocket';
import { useMeetingRoom } from '@/hooks/useMeetingRoom';
import { useLiveCaptions } from '@/hooks/useLiveCaptions';
import { useLiveKitRoom } from '@/hooks/useLiveKitRoom';
import api from '@/lib/api';
import { useMeetings } from '@/store/useMeetings';
import { useAuth } from '@/store/useAuth';
import { useUI } from '@/store/useUI';
import { cn, videoGridCols } from '@/lib/utils';

/** Attaches a MediaStream to a <video> element. */
function VideoTile({ stream, name, avatar, muted = false, mirror = false, label, fit = 'cover', className, handRaised = false, reactions = [], hostControls = null }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  return (
    <div className={cn('group relative overflow-hidden rounded-2xl bg-navy-950/80 shadow-soft', fit === 'contain' && 'bg-black', handRaised && 'ring-2 ring-amber-400', className)}>
      <video ref={ref} autoPlay playsInline muted={muted} className={cn('h-full w-full', fit === 'contain' ? 'object-contain' : 'object-cover', mirror && 'scale-x-[-1]', !hasVideo && 'invisible')} />
      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar src={avatar} name={name} size="xl" />
        </div>
      )}
      {handRaised && (
        <span className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-navy-950 shadow-lg animate-bounce"><Hand size={16} /></span>
      )}
      {/* Floating emoji reactions for this tile */}
      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center gap-1">
        {reactions.map((r) => (
          <span key={r.id} className="animate-float-up text-3xl drop-shadow">{r.emoji}</span>
        ))}
      </div>
      {label && (
        <span className="absolute bottom-2 left-2 max-w-[85%] truncate rounded-lg bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{label}</span>
      )}
      {hostControls && (
        // Hover-only would make these unreachable on touch devices (no hover),
        // so they stay visible on phones and only hide behind hover from sm: up.
        <div className="absolute right-2 top-2 flex gap-1 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <button onClick={hostControls.onMute} title="Ask to mute" className="grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:h-8 sm:w-8"><MicOffIcon size={14} /></button>
          <button onClick={hostControls.onRemove} title="Remove from meeting" className="grid h-10 w-10 place-items-center rounded-full bg-red-500/80 text-white hover:bg-red-600 sm:h-8 sm:w-8"><UserX size={14} /></button>
        </div>
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

/**
 * Transport selector: ask the server whether this meeting runs on the LiveKit
 * SFU (scales past ~6 people) or the peer-to-peer mesh, then mount the matching
 * room. Both render the identical RoomView UI.
 */
function Room({ meeting, code, me, onLeave }) {
  const isHost = String(meeting.host?._id || meeting.host) === String(me?._id);
  const [rtc, setRtc] = useState(undefined); // undefined=checking · null=mesh · {url,token}=sfu

  useEffect(() => {
    let cancelled = false;
    api.get(`/meetings/code/${encodeURIComponent(code)}/rtc`)
      .then(({ data }) => { if (!cancelled) setRtc(data?.enabled ? data : null); })
      .catch(() => { if (!cancelled) setRtc(null); }); // any failure → mesh
    return () => { cancelled = true; };
  }, [code]);

  if (rtc === undefined) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-navy-950 text-white">
        <div className="flex flex-col items-center gap-3"><Loader2 className="animate-spin" size={28} /><p className="text-sm text-white/70">Preparing the room…</p></div>
      </div>
    );
  }
  const props = { meeting, code, me, isHost, onLeave };
  return rtc ? <SfuRoom {...props} rtc={rtc} /> : <MeshRoom {...props} />;
}

function MeshRoom({ meeting, code, me, isHost, onLeave }) {
  const room = useMeetingRoom(meeting._id, {
    video: meeting.type !== 'audio',
    muteOnEntry: meeting.settings?.muteOnEntry,
    autoRecord: meeting.settings?.autoRecord,
    isHost,
  });
  return <RoomView room={room} meeting={meeting} code={code} me={me} isHost={isHost} onLeave={onLeave} />;
}

function SfuRoom({ meeting, code, me, isHost, rtc, onLeave }) {
  const room = useLiveKitRoom(meeting._id, {
    video: meeting.type !== 'audio',
    muteOnEntry: meeting.settings?.muteOnEntry,
    autoRecord: meeting.settings?.autoRecord,
    isHost,
    code,
    rtc,
  });
  return <RoomView room={room} meeting={meeting} code={code} me={me} isHost={isHost} onLeave={onLeave} />;
}

function RoomView({ room, meeting, code, me, isHost, onLeave }) {
  const {
    localStream, screenStream, remotes, presenterSid, status, muted, camOff, sharingScreen, recording, mediaError,
    toggleMute, toggleCamera, toggleScreenShare, toggleRecording, leave,
    chatMessages, reactions, raisedHands, handRaised,
    sendChat, sendReaction, toggleHand, muteEveryone, muteParticipant, removeParticipant,
    knocks = [], admitGuest,
    polls = [], questions = [], createPoll, votePoll, closePoll, askQuestion, upvoteQuestion, answerQuestion,
  } = room;
  const [portrait, setPortrait] = useState(false); // tile orientation option
  const [showChat, setShowChat] = useState(false);
  const [showPolls, setShowPolls] = useState(false);
  // `muted` is passed so a muted mic never broadcasts captions of what you say.
  const captions = useLiveCaptions(meeting._id, { myName: me?.name || 'You', muted });
  // Captions can fail for reasons only the browser knows (mic busy, no network,
  // permission blocked). The hook has always reported them; nothing rendered it,
  // so a failure looked like "the button does nothing".
  useEffect(() => {
    if (captions.error) toast.error(captions.error, { id: 'caption-error' });
  }, [captions.error]);
  const [chatInput, setChatInput] = useState('');
  const [showReactions, setShowReactions] = useState(false);
  const [seenChatCount, setSeenChatCount] = useState(0);
  const chatEndRef = useRef(null);
  const reactionsForRemote = (sid) => reactions.filter((r) => r.socketId === sid);
  const myReactions = reactions.filter((r) => r.socketId === 'me');

  useEffect(() => { if (status === 'left') onLeave(); }, [status, onLeave]);
  useEffect(() => { if (showChat) { setSeenChatCount(chatMessages.length); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } }, [chatMessages, showChat]);
  const unreadChat = Math.max(0, chatMessages.length - seenChatCount);

  const submitChat = (e) => {
    e.preventDefault();
    const t = chatInput.trim();
    if (!t) return;
    sendChat(t);
    setChatInput('');
  };
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🙏', '🔥'];

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

  // Ask-to-join: we knocked and the host hasn't answered yet.
  if (status === 'knocking') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-navy-950 p-6 text-center text-white">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/20 text-brand-300"><DoorOpen size={26} className="animate-pulse" /></span>
          <h1 className="text-lg font-bold">Asking to join…</h1>
          <p className="text-sm text-white/70">{mediaError || 'You’ll enter as soon as the host lets you in.'}</p>
          <p className="text-xs text-white/50">Meeting ID <span className="font-mono">{code}</span></p>
          <Button variant="glass" onClick={doLeave}>Cancel</Button>
        </div>
      </div>
    );
  }

  // The host denied the request (or nobody answered the knock).
  if (status === 'denied') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-navy-950 p-6 text-center text-white">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-400"><UserX size={26} /></span>
          <h1 className="text-lg font-bold">You can’t join this meeting</h1>
          <p className="text-sm text-white/70">{mediaError || 'The host didn’t let you in.'}</p>
          <Button variant="glass" onClick={doLeave}>Back to meetings</Button>
        </div>
      </div>
    );
  }

  const total = remotes.length + 1;
  const cols = videoGridCols(total);
  // A tile with NO aspect-ratio class has no definite height in a CSS grid (a
  // <video> with h-full/w-full can't resolve a percentage height against an
  // "auto" parent) — it used to collapse to the video's raw stream resolution,
  // making tiles inconsistent sizes across devices. Always give it one.
  // Grid cells now carry the definite height (auto-rows-fr on a fixed-height grid),
  // so a tile fills its cell rather than dictating its own height — that is what
  // keeps every participant on one screen. Portrait keeps a 3:4 shape, derived from
  // the cell's height so it still cannot overflow.
  const tileAspect = portrait ? 'h-full w-auto aspect-[3/4] max-w-full' : 'h-full w-full';

  // Spotlight: whoever is presenting a screen (you or a remote peer) fills the
  // stage (object-contain so nothing is cropped) with everyone else in a strip.
  const presenting = Boolean(presenterSid);
  const presenterIsMe = presenterSid === 'me';
  const presenterRemote = !presenterIsMe ? remotes.find((r) => r.socketId === presenterSid) : null;
  const presenterStream = presenterIsMe ? screenStream : presenterRemote?.stream;
  const presenterName = presenterIsMe ? 'You' : presenterRemote?.user?.name || 'Guest';

  return (
    // `relative` anchors the absolutely-positioned knock prompts + chat drawer
    // to the room rather than to the page's initial containing block.
    <div className="relative flex h-[100dvh] flex-col bg-navy-950 text-white">
      {/* Host admission prompts — someone knocked and wants to join (Google-Meet style). */}
      {isHost && knocks.length > 0 && (
        <div className="absolute left-1/2 top-16 z-40 flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-2">
          {knocks.map((k) => (
            <div key={k.socketId} className="flex items-center gap-3 rounded-2xl border border-white/15 bg-navy-900/95 p-3 shadow-soft-lg backdrop-blur-md">
              <Avatar src={k.avatar} name={k.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{k.name || 'Someone'}</p>
                <p className="text-xs text-white/60">wants to join this meeting</p>
              </div>
              <button
                onClick={() => admitGuest?.(k, false)}
                title="Deny"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-red-500/80 hover:text-white sm:h-9 sm:w-9"
              >
                <X size={16} />
              </button>
              <button
                onClick={() => admitGuest?.(k, true)}
                title="Admit"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 sm:h-9 sm:w-9"
              >
                <Check size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* shrink-0 (like the footer): header + banners + footer keep their natural
          height and the stage takes exactly the rest, so the room is always one
          screen tall and never scrolls. */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{meeting.title}</p>
          <button onClick={copyId} title="Copy meeting ID" className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/90">
            <Users size={12} /> {total} in call
            <span className="hidden sm:inline">
              &nbsp;· Meeting ID <span className="font-mono">{code}</span>
            </span>
            <Copy size={11} className="hidden sm:inline" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {recording && <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-300"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> REC</span>}
          {isHost && (
            <Button variant="glass" size="sm" onClick={muteEveryone} title="Mute everyone"><ShieldCheck size={14} /> <span className="hidden sm:inline">Mute all</span></Button>
          )}
          <button onClick={() => setShowChat((v) => !v)} className={cn('relative grid h-11 w-11 place-items-center rounded-xl transition-colors sm:h-9 sm:w-9', showChat ? 'bg-white text-navy-950' : 'bg-white/10 text-white hover:bg-white/20')} title="Meeting chat">
            <MessageSquare size={18} />
            {unreadChat > 0 && !showChat && <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">{unreadChat}</span>}
          </button>
          <button
            onClick={() => { setShowPolls((v) => !v); setShowChat(false); }}
            className={cn('relative grid h-11 w-11 place-items-center rounded-xl transition-colors sm:h-9 sm:w-9', showPolls ? 'bg-white text-navy-950' : 'bg-white/10 text-white hover:bg-white/20')}
            title="Polls & Q&A"
          >
            <BarChart3 size={18} />
            {polls.length + questions.length > 0 && !showPolls && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">
                {polls.length + questions.length}
              </span>
            )}
          </button>
          {/* Disabled rather than hidden where unsupported, with the reason in the
              tooltip — a silently missing control reads as a bug. */}
          <button
            onClick={captions.toggle}
            disabled={!captions.supported}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-xl transition-colors sm:h-9 sm:w-9',
              captions.enabled ? 'bg-white text-navy-950' : 'bg-white/10 text-white hover:bg-white/20',
              !captions.supported && 'cursor-not-allowed opacity-40 hover:bg-white/10'
            )}
            title={
              !captions.supported
                ? 'Live captions need Chrome or Edge'
                : captions.enabled
                  // Say why nothing is appearing rather than looking broken.
                  ? (muted ? 'Captions on — unmute to caption your speech' : 'Turn off captions')
                  : 'Turn on live captions'
            }
          >
            <Captions size={18} />
          </button>
          <Button variant="glass" size="sm" onClick={copyLink}><Copy size={14} /> <span className="hidden sm:inline">Copy link</span></Button>
        </div>
      </header>

      {mediaError && (
        <div className="mx-3 mb-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300 sm:mx-4">{mediaError}</div>
      )}

      {/* Presenting banner — you always SEE what you're sharing (like Google Meet).
          It wraps on phones: label + "Stop presenting" in one rounded-full row is
          wider than 320px, and the room clips (no page scroll) so the button
          would simply be unreachable. */}
      {sharingScreen && (
        <div className="mx-3 mb-2 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-emerald-500/15 px-4 py-1.5 text-xs text-emerald-200 ring-1 ring-emerald-500/30 sm:mx-auto sm:gap-3 sm:rounded-full sm:text-sm">
          <MonitorUp size={15} className="shrink-0" />
          <span className="font-medium">You’re presenting to everyone</span>
          <button onClick={toggleScreenShare} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600">Stop presenting</button>
        </div>
      )}
      {!sharingScreen && presenting && presenterRemote && (
        <div className="mx-3 mb-2 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-cyan-500/15 px-4 py-1.5 text-xs text-cyan-200 ring-1 ring-cyan-500/30 sm:mx-auto sm:rounded-full sm:text-sm">
          <MonitorUp size={15} className="shrink-0" />
          <span className="min-w-0 break-words font-medium">{presenterName} is presenting</span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Single-screen stage. The tile grid is sized to the space available
            (`auto-rows-fr` splits the height across however many rows there are),
            so ANY participant count fits on one screen with no scrolling — the
            previous fixed `aspect-video` tiles forced a definite height per row
            and pushed later rows out of view behind the control bar.
            Only the presenting layout keeps a scroll axis (its horizontal
            filmstrip), so the grid path clips instead. */}
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex flex-col px-2 sm:px-4',
            presenting && presenterStream ? 'scrollbar-thin overflow-y-auto' : 'overflow-hidden'
          )}
        >
        {presenting && presenterStream ? (
          <div className="flex h-full flex-col gap-2 sm:gap-3">
            {/* min-h floor: on short/mobile viewports flex sizing alone can
                squeeze the shared screen to near-nothing — always keep it usable. */}
            <VideoTile stream={presenterStream} name={presenterName} muted={presenterIsMe} fit="contain" label={presenterIsMe ? 'Your shared screen' : `${presenterName}’s screen`} className="min-h-[38vh] flex-1 sm:min-h-[45vh]" />
            {/* w-fit + mx-auto instead of justify-center: a centred flex scroll
                container makes its left-most tiles unreachable once it overflows. */}
            <div className="scrollbar-thin mx-auto flex w-fit max-w-full shrink-0 gap-2 overflow-x-auto pb-2">
              <VideoTile stream={localStream} name={me?.name} avatar={me?.avatar} muted mirror label={`${me?.name || 'You'} (you)`} handRaised={handRaised} reactions={myReactions} className="h-16 w-24 shrink-0 sm:h-20 sm:w-32 md:h-24 md:w-36 2xl:h-28 2xl:w-44" />
              {remotes.filter((r) => r.socketId !== presenterSid).map((r) => (
                <VideoTile key={r.socketId} stream={r.stream} name={r.user?.name} avatar={r.user?.avatar} label={r.user?.name || 'Guest'} handRaised={!!raisedHands[r.socketId]} reactions={reactionsForRemote(r.socketId)} className="h-16 w-24 shrink-0 sm:h-20 sm:w-32 md:h-24 md:w-36 2xl:h-28 2xl:w-44" />
              ))}
            </div>
          </div>
        ) : (
          <div className={cn('grid min-h-0 flex-1 auto-rows-fr gap-2 py-1 sm:gap-3', cols, portrait && 'place-items-center')}>
            <VideoTile stream={localStream} name={me?.name} avatar={me?.avatar} muted mirror label={`${me?.name || 'You'} (you)${muted ? ' · muted' : ''}`} handRaised={handRaised} reactions={myReactions} className={tileAspect} />
            {remotes.map((r) => (
              <VideoTile
                key={r.socketId}
                stream={r.stream}
                name={r.user?.name}
                avatar={r.user?.avatar}
                label={r.user?.name || 'Guest'}
                handRaised={!!raisedHands[r.socketId]}
                reactions={reactionsForRemote(r.socketId)}
                hostControls={isHost ? { onMute: () => muteParticipant(r.socketId), onRemove: () => removeParticipant(r.socketId) } : null}
                className={tileAspect}
              />
            ))}
          </div>
        )}
        {remotes.length === 0 && !presenting && (
          // shrink-0 so this line takes its own height from the flex column
          // instead of being added on top of a full-height grid (which would
          // overflow the stage and reintroduce scrolling).
          <p className="shrink-0 py-2 text-center text-sm text-white/50">
            {status === 'connecting' ? 'Connecting…' : 'You’re the only one here. Share the meeting ID or link to invite others.'}
          </p>
        )}
        </div>

        {/* In-meeting chat drawer. On narrow screens this OVERLAYS the video
            (absolute, full-bleed) instead of sharing the flex row with it —
            a fixed-width sidebar on a phone-size viewport used to squeeze the
            video pane down to a sliver. From sm: up it's a normal side panel. */}
        {/* z-20, below the drawers (z-30), so an open panel covers the captions
            rather than having text bleed through it. */}
        <CaptionOverlay lines={captions.lines} />

        <MeetingPollsPanel
          open={showPolls}
          onClose={() => setShowPolls(false)}
          isHost={isHost}
          myUserId={me?._id}
          polls={polls}
          questions={questions}
          onCreatePoll={createPoll}
          onVote={votePoll}
          onClosePoll={closePoll}
          onAsk={askQuestion}
          onUpvote={upvoteQuestion}
          onAnswer={answerQuestion}
        />

        {showChat && (
          /* bg-navy-950/[0.98] — a bare `/98` modifier isn't in Tailwind's opacity
             scale, so it emitted no rule at all and the video showed through the
             full-screen mobile drawer. */
          <aside className="absolute inset-0 z-30 flex flex-col bg-navy-950/[0.98] sm:static sm:inset-auto sm:z-auto sm:w-80 sm:shrink-0 sm:border-l sm:border-white/10 sm:bg-navy-950/95 lg:w-96 2xl:w-[28rem]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="min-w-0 truncate font-semibold">In-call messages</p>
              <button onClick={() => setShowChat(false)} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/60 hover:text-white sm:h-9 sm:w-9"><X size={18} /></button>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {chatMessages.length === 0 && <p className="text-center text-xs text-white/40">Messages are only visible to people in this call.</p>}
              {chatMessages.map((m) => (
                <div key={m.id} className={cn('flex flex-col', m.mine && 'items-end')}>
                  {!m.mine && <span className="mb-0.5 text-[11px] font-medium text-white/50">{m.name || 'Guest'}</span>}
                  <div className={cn('max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm', m.mine ? 'bg-brand-500 text-white' : 'bg-white/10 text-white')}>{m.text}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* text-base on phones — anything under 16px makes iOS zoom the page on focus. */}
            <form onSubmit={submitChat} className="flex shrink-0 items-center gap-2 border-t border-white/10 p-3">
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Send a message" className="ring-brand min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-base text-white placeholder:text-white/40 sm:text-sm" />
              <button type="submit" disabled={!chatInput.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500 text-white disabled:opacity-50 sm:h-9 sm:w-9"><Send size={16} /></button>
            </form>
          </aside>
        )}
      </div>

      {/* flex-wrap: on narrow phones 7-8 circular controls at full size don't fit
          one row — they used to overflow off-screen instead of wrapping. */}
      <footer className="mb-safe flex shrink-0 flex-wrap items-center justify-center gap-2 px-3 py-4 sm:gap-3 sm:px-4 sm:py-5">
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
        <CtrlButton active={handRaised} onClick={toggleHand} on={<Hand size={20} />} off={<Hand size={20} />} label={handRaised ? 'Lower hand' : 'Raise hand'} highlightWhenActive />
        <div className="relative">
          <CtrlButton active={showReactions} onClick={() => setShowReactions((v) => !v)} on={<Smile size={20} />} off={<Smile size={20} />} label="React" highlightWhenActive />
          {showReactions && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
              {/* Fixed + wrapping: 8 emoji buttons in one row are ~356px wide, so
                  anchored to the (possibly off-centre) React button they ran off
                  the side of a 320px screen. The offsets clear the control bar,
                  which wraps to two rows on phones, plus the home indicator. */}
              <div className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex w-[min(92vw,20rem)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-2xl bg-navy-950/95 p-2 shadow-soft-lg ring-1 ring-white/10 sm:bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:w-auto sm:flex-nowrap">
                {REACTION_EMOJIS.map((e) => (
                  <button key={e} onClick={() => { sendReaction(e); setShowReactions(false); }} className="grid h-11 w-11 place-items-center rounded-xl text-2xl transition-transform hover:scale-125 hover:bg-white/10 sm:h-10 sm:w-10">{e}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <CtrlButton active={recording} onClick={toggleRecording} on={<Disc size={20} />} off={<Disc size={20} />} label={recording ? 'Stop recording' : 'Record'} highlightWhenActive />
        <button onClick={doLeave} className="grid h-12 w-12 place-items-center rounded-full bg-red-500 text-white transition-transform hover:scale-105 sm:h-14 sm:w-14" title="Leave">
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
        'grid h-12 w-12 place-items-center rounded-full transition-colors sm:h-14 sm:w-14',
        highlighted ? 'bg-white text-navy-950' : 'bg-white/10 text-white hover:bg-white/20'
      )}
    >
      {active ? on : off}
    </button>
  );
}
