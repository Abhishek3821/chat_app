import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, Copy, Users, Loader2, AlertTriangle, Disc, Hourglass, RectangleHorizontal, RectangleVertical, MessageSquare, Hand, Smile, Send, X, UserX, MicOff as MicOffIcon, ShieldCheck, Check, DoorOpen, BarChart3, Captions, Maximize2, Minimize2, Sparkles, MoreHorizontal } from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import MeetingPollsPanel from '@/components/meeting/MeetingPollsPanel';
import CaptionOverlay from '@/components/meeting/CaptionOverlay';
import { useSocket } from '@/hooks/useSocket';
import { useViewportSize } from '@/hooks/useViewportSize';
import { useMeetingRoom } from '@/hooks/useMeetingRoom';
import { useLiveCaptions } from '@/hooks/useLiveCaptions';
import { useLiveKitRoom } from '@/hooks/useLiveKitRoom';
import { meshCapacityWarning } from '@/lib/meshQuality';
import api from '@/lib/api';
import { useMeetings } from '@/store/useMeetings';
import { useAuth } from '@/store/useAuth';
import { useUI } from '@/store/useUI';
import { cn, videoGridCols } from '@/lib/utils';
import { EFFECTS, BACKGROUND_PRESETS, effectsSupported, gradientDataUrl } from '@/lib/videoEffects';

/* Module scope, not inside RoomView: the phone control sheet (<MoreControls>)
   renders the same set, and a per-render local const wasn't reachable from it. */
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🙏', '🔥'];

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
  return <RoomView room={room} meeting={meeting} code={code} me={me} isHost={isHost} onLeave={onLeave} isSfu />;
}

function RoomView({ room, meeting, code, me, isHost, onLeave, isSfu = false }) {
  const {
    localStream, screenStream, remotes, presenterSid, status, muted, camOff, sharingScreen, recording, mediaError,
    toggleMute, toggleCamera, toggleScreenShare, toggleRecording, leave,
    chatMessages, reactions, raisedHands, handRaised,
    sendChat, sendReaction, toggleHand, muteEveryone, muteParticipant, removeParticipant,
    knocks = [], admitGuest,
    polls = [], questions = [], createPoll, votePoll, closePoll, askQuestion, upvoteQuestion, answerQuestion,
    videoEffect = EFFECTS.NONE, effectLoading = false, setVideoEffect,
  } = room;
  const [portrait, setPortrait] = useState(false); // tile orientation option
  const [showChat, setShowChat] = useState(false);
  const [showPolls, setShowPolls] = useState(false);
  /* Below `sm` the control bar keeps only the controls you reach for mid-sentence
     and folds the rest into one sheet — see <MoreControls>. Read from the live
     viewport rather than a CSS breakpoint because the SPLIT is structural (which
     buttons exist), not cosmetic. */
  const { width: viewportWidth } = useViewportSize();
  const compact = viewportWidth < 640;
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

  /* True fullscreen (F11-style), on the room element rather than the document,
     so the chat drawer and knock prompts — which are positioned against the room
     — come along instead of being left behind on the page underneath.
     `fullscreenchange` is the source of truth for the icon: the user can also
     leave with Escape, and tracking our own clicks would desync on that. */
  const roomRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    // Safari <16.4 and some embedded webviews have no requestFullscreen; failing
    // silently is right — the room is already full-viewport without it.
    else roomRef.current?.requestFullscreen?.().catch(() => {});
  };

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
  /* Only the MESH is size-limited. On the SFU each device sends one stream and
     the server fans it out, so the warning must not appear there — `isSfu` is
     passed down by SfuRoom. */
  const capacityWarning = isSfu ? null : meshCapacityWarning(total);
  const cols = videoGridCols(total);
  // A tile with NO aspect-ratio class has no definite height in a CSS grid (a
  // <video> with h-full/w-full can't resolve a percentage height against an
  // "auto" parent) — it used to collapse to the video's raw stream resolution,
  // making tiles inconsistent sizes across devices. Always give it one.
  // Grid cells now carry the definite height (auto-rows-fr on a fixed-height grid),
  // so a tile fills its cell rather than dictating its own height — that is what
  // keeps every participant on one screen. Portrait keeps a 3:4 shape, derived from
  // the cell's height so it still cannot overflow.
  /* Landscape tiles keep a 16:9 SHAPE and are centred in their cell, rather than
     stretching to whatever shape the cell happens to be. Stretching is what made
     a solo call look broken on a wide monitor: one tile inherited the whole
     stage (~3:1), and `object-cover` then cropped a 16:9 camera feed to that —
     roughly a fifth off the top and bottom, which lands squarely on the
     speaker's head. Same rule the portrait option already used. */
  const tileAspect = portrait
    ? 'h-full w-auto aspect-[3/4] max-w-full'
    // Which axis leads flips with the shape of the cell: on a phone the cell is
    // taller than 16:9, so width leads and the tile is centred vertically; from
    // sm: up it is wider, so height leads and the tile is centred horizontally.
    // Picking one axis for both squashes the other case back into a hard crop.
    : 'aspect-video w-full h-auto max-h-full sm:h-full sm:w-auto sm:max-w-full';

  /* A lone 16:9 tile on a portrait phone is a thin strip floating in a screen of
     empty navy — most of the room is wasted on the one layout people see most
     (you, waiting for someone to join). Below sm the solo tile fills the stage
     instead: width AND height are set, so `aspect-video` doesn't apply and
     object-cover crops to the frame, which is exactly what every phone call app
     does. From sm: up nothing changes — the anti-crop rule above still holds,
     and the portrait option still wins when it's on. */
  const soloTile = total === 1 && !portrait;

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
    <div ref={roomRef} className="relative flex h-[100dvh] flex-col bg-navy-950 text-white">
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
      {/* Stacked on a phone, one row from sm: up. Six 44px controls plus the
          host's "Mute all" leave ~40px for the title on a 360px screen, which
          rendered every meeting name as "Sup…" and wrapped "1 in call" onto its
          own line. Given a line of its own the title fits, and the meeting ID
          (the thing you need in order to invite anyone) fits with it. */}
      <header className="flex shrink-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3">
        <div className="min-w-0 sm:flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{meeting.title}</p>
          <button onClick={copyId} title="Copy meeting ID" className="flex max-w-full items-center gap-1.5 text-xs text-white/60 hover:text-white/90">
            <Users size={12} className="shrink-0" />
            <span className="shrink-0">{total} in call</span>
            <span className="min-w-0 truncate">
              · Meeting ID <span className="font-mono">{code}</span>
            </span>
            <Copy size={11} className="shrink-0" />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {recording && <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-300"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> REC</span>}
          {isHost && (
            <Button variant="glass" size="sm" onClick={muteEveryone} title="Mute everyone"><ShieldCheck size={14} /> <span className="hidden sm:inline">Mute all</span></Button>
          )}
          <button
            onClick={toggleFullscreen}
            className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 sm:h-9 sm:w-9"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
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

      {/* A peer-to-peer room past its comfortable size. Said out loud rather than
          left to manifest as frozen tiles: without this the room simply degrades
          and everyone blames their own connection. Amber, not red — the meeting
          still works, it is just past what a mesh carries well. */}
      {capacityWarning && (
        <div className="mx-3 mb-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30 sm:mx-4">
          {capacityWarning}
        </div>
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
            // `relative` anchors the solo-call hint pill to the stage.
            'relative min-h-0 min-w-0 flex-1 flex flex-col px-2 sm:px-4',
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
          /* place-items-center always, not just for portrait: tiles now size to
             their own aspect ratio, so without it they'd sit hard against the
             start of the cell instead of being centred in the leftover space. */
          <div className={cn('grid min-h-0 flex-1 auto-rows-fr place-items-center gap-2 py-1 sm:gap-3', cols)}>
            <VideoTile
              stream={localStream}
              name={me?.name}
              avatar={me?.avatar}
              muted
              mirror
              label={`${me?.name || 'You'} (you)${muted ? ' · muted' : ''}`}
              handRaised={handRaised}
              reactions={myReactions}
              /* Order matters — `cn` is tailwind-merge, so the override has to
                 come last. Only the UNPREFIXED h/w are replaced; tileAspect's
                 `sm:` half survives, which is what keeps desktop unchanged. */
              className={cn(tileAspect, soloTile && 'h-full w-full')}
            />
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
          /* An OVERLAY pill rather than a row in the flex column. As a row it
             took a slice of the stage's height for a hint you read once, which
             on a laptop is the difference between the tile filling the screen
             and being visibly short of it. pointer-events-none so it can never
             swallow a click meant for the tile beneath. */
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
            {/* Wraps on a phone instead of truncating: the one-line pill cut the
                sentence to "…share the meeting ID or link …", which is the half
                that carried the instruction. It only truncates from sm: up, where
                the whole thing fits on a line anyway. */}
            <p className="max-w-full rounded-2xl bg-navy-950/70 px-3.5 py-1.5 text-center text-xs text-white/70 shadow-soft backdrop-blur-md sm:truncate sm:rounded-full sm:text-sm">
              {status === 'connecting' ? 'Connecting…' : 'You’re the only one here — share the meeting ID or link to invite others.'}
            </p>
          </div>
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

      {/* One row, always. Nine 48px circles are ~500px wide, so on a phone the bar
          used to wrap into a ragged six-then-three with Leave stranded at the end
          of the second row. Below `sm` only the mid-conversation controls stay out
          here (mic, camera, present, hand) and the rest live in one sheet, which
          also gives them labels — an unlabelled circle is a guess. */}
      <footer className="mb-safe flex shrink-0 flex-wrap items-center justify-center gap-1.5 px-3 py-4 sm:gap-3 sm:px-4 sm:py-5">
        <CtrlButton active={!muted} onClick={toggleMute} on={<Mic size={20} />} off={<MicOff size={20} />} label={muted ? 'Unmute' : 'Mute'} />
        {meeting.type !== 'audio' && (
          <CtrlButton active={!camOff} onClick={toggleCamera} on={<Video size={20} />} off={<VideoOff size={20} />} label={camOff ? 'Start video' : 'Stop video'} />
        )}
        {meeting.type !== 'audio' && (
          <CtrlButton active={sharingScreen} onClick={toggleScreenShare} on={<MonitorX size={20} />} off={<MonitorUp size={20} />} label={sharingScreen ? 'Stop presenting' : 'Share screen'} highlightWhenActive />
        )}
        {/* highlightWhenActive: without it the default (landscape) rendered as the
            one solid-white button in the bar, so the tile-shape toggle read as the
            most important control on the screen. */}
        {!compact && meeting.type !== 'audio' && (
          <CtrlButton
            active={portrait}
            onClick={() => setPortrait((v) => !v)}
            on={<RectangleVertical size={20} />}
            off={<RectangleHorizontal size={20} />}
            label={portrait ? 'Switch to landscape tiles' : 'Switch to portrait tiles'}
            highlightWhenActive
          />
        )}
        <CtrlButton active={handRaised} onClick={toggleHand} on={<Hand size={20} />} off={<Hand size={20} />} label={handRaised ? 'Lower hand' : 'Raise hand'} highlightWhenActive />
        {!compact && (
          <div className="relative">
            <CtrlButton active={showReactions} onClick={() => setShowReactions((v) => !v)} on={<Smile size={20} />} off={<Smile size={20} />} label="React" highlightWhenActive />
            {showReactions && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
                {/* Fixed rather than anchored: 8 emoji buttons in one row are
                    ~356px wide, so hung off the (possibly off-centre) React button
                    they ran past the side of the screen. */}
                <div className="fixed bottom-[calc(7rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 justify-center gap-1 rounded-2xl bg-navy-950/95 p-2 shadow-soft-lg ring-1 ring-white/10">
                  {REACTION_EMOJIS.map((e) => (
                    <button key={e} onClick={() => { sendReaction(e); setShowReactions(false); }} className="grid h-10 w-10 place-items-center rounded-xl text-2xl transition-transform hover:scale-125 hover:bg-white/10">{e}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {/* Background effects. Only offered when the browser can actually run
            them, and hidden on the SFU path where the track isn't ours to swap. */}
        {!compact && setVideoEffect && effectsSupported() && (
          <BackgroundButton current={videoEffect} loading={effectLoading} onPick={setVideoEffect} />
        )}
        {!compact && (
          <CtrlButton active={recording} onClick={toggleRecording} on={<Disc size={20} />} off={<Disc size={20} />} label={recording ? 'Stop recording' : 'Record'} highlightWhenActive />
        )}
        {compact && (
          <MoreControls
            isVideo={meeting.type !== 'audio'}
            portrait={portrait}
            onTogglePortrait={() => setPortrait((v) => !v)}
            recording={recording}
            onToggleRecording={toggleRecording}
            onReact={sendReaction}
            effect={videoEffect}
            effectLoading={effectLoading}
            onPickEffect={setVideoEffect && effectsSupported() ? setVideoEffect : null}
          />
        )}
        {/* Deliberately a size up from the rest on a phone — it is the one control
            you must be able to hit without looking. */}
        <button onClick={doLeave} className="grid h-12 w-12 place-items-center rounded-full bg-red-500 text-white transition-transform hover:scale-105 sm:h-14 sm:w-14" title="Leave">
          <PhoneOff size={22} />
        </button>
      </footer>
    </div>
  );
}

/** A preset from BACKGROUND_PRESETS → the (effect, payload) pair the room wants.
 *  Shared by the desktop menu and the phone sheet so the two can't drift. */
function pickPreset(preset, onPick) {
  if (!preset) return onPick(EFFECTS.NONE);
  if (preset.effect === EFFECTS.BLUR) return onPick(EFFECTS.BLUR);
  return onPick(EFFECTS.IMAGE, gradientDataUrl(preset.gradient));
}

/** One labelled row in the phone control sheet. */
function SheetRow({ icon: Icon, label, hint, active = false, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left transition-colors hover:bg-white/10"
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', active ? 'bg-white text-navy-950' : 'bg-white/10 text-white')}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{label}</span>
        {hint && <span className="block truncate text-[11px] text-white/50">{hint}</span>}
      </span>
      {active && <Check size={16} className="shrink-0 text-white/70" />}
    </button>
  );
}

/**
 * Phone-only overflow for the secondary meeting controls.
 *
 * The bar carries nine controls, which is fine on a laptop and two ragged rows on
 * a 360px phone. Reactions, backgrounds, recording and tile shape move in here:
 * the ones you touch while talking stay on the bar, and these get labels.
 *
 * The sheet is pinned to the viewport's gutters rather than anchored to its
 * button — the bar is centred, so an anchored menu hangs off whichever edge the
 * button happens to sit near.
 */
function MoreControls({ isVideo, portrait, onTogglePortrait, recording, onToggleRecording, onReact, effect, effectLoading, onPickEffect }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <CtrlButton
        active={open}
        onClick={() => setOpen((v) => !v)}
        on={<MoreHorizontal size={20} />}
        off={<MoreHorizontal size={20} />}
        label="More options"
        highlightWhenActive
      />
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={close} aria-label="Close options" />
          <div className="fixed inset-x-3 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-3xl bg-navy-900/95 p-2 shadow-soft-lg ring-1 ring-white/10 backdrop-blur-xl">
            {onReact && (
              <div className="flex justify-between gap-0.5 px-1 pb-2 pt-1">
                {REACTION_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact(e); close(); }}
                    title={`React ${e}`}
                    /* 36px, not the usual 44: eight of them have to fit one row
                       inside a sheet that is only as wide as a 360px screen. */
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xl transition-transform hover:bg-white/10 active:scale-90"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            {onPickEffect && (
              <div className="border-t border-white/10 px-1 pb-1 pt-2">
                <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                  Background {effectLoading && <Loader2 size={11} className="ml-1 inline animate-spin" />}
                </p>
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => { pickPreset(null, onPickEffect); close(); }}
                    title="No background effect"
                    className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-[10px] font-semibold text-white/70', effect === EFFECTS.NONE ? 'border-white bg-white/15 text-white' : 'border-white/25')}
                  >
                    Off
                  </button>
                  {BACKGROUND_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { pickPreset(p, onPickEffect); close(); }}
                      title={p.label}
                      aria-label={p.label}
                      className="h-11 w-11 shrink-0 rounded-xl border border-white/25"
                      style={p.gradient ? { background: `linear-gradient(135deg, ${p.gradient[0]}, ${p.gradient[1]})` } : { backdropFilter: 'blur(4px)', background: 'rgba(255,255,255,.18)' }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="border-t border-white/10 pt-1">
              {isVideo && (
                <SheetRow
                  icon={portrait ? RectangleVertical : RectangleHorizontal}
                  label="Tile shape"
                  hint={portrait ? 'Portrait — tap for landscape' : 'Landscape — tap for portrait'}
                  active={portrait}
                  onClick={() => { onTogglePortrait(); close(); }}
                />
              )}
              <SheetRow
                icon={Disc}
                label={recording ? 'Stop recording' : 'Record meeting'}
                hint={recording ? 'Recording now' : 'Saves to your device'}
                active={recording}
                onClick={() => { onToggleRecording(); close(); }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Background picker: none / blur / a few gradient scenes.
 *
 * The menu opens UPWARD from the control bar and is rendered in normal flow
 * (the bar isn't a scroll container), so no portal is needed here.
 */
function BackgroundButton({ current, loading, onPick }) {
  const [open, setOpen] = useState(false);
  const active = current !== EFFECTS.NONE;

  const choose = (preset) => {
    setOpen(false);
    pickPreset(preset, onPick);
  };

  return (
    <div className="relative">
      <CtrlButton
        active={active}
        onClick={() => setOpen((v) => !v)}
        on={loading ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
        off={loading ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
        label="Background"
        highlightWhenActive
      />
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label="Close background picker" />
          <div className="absolute bottom-full left-1/2 z-20 mb-3 w-52 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/15 bg-navy-900/95 p-1.5 shadow-soft-lg backdrop-blur-md">
            <button
              onClick={() => choose(null)}
              className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/10', current === EFFECTS.NONE ? 'text-white' : 'text-white/70')}
            >
              <span className="h-7 w-7 shrink-0 rounded-lg border border-white/25" />
              None
              {current === EFFECTS.NONE && <Check size={15} className="ml-auto" />}
            </button>
            {BACKGROUND_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => choose(p)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-white/70 transition-colors hover:bg-white/10"
              >
                <span
                  className="h-7 w-7 shrink-0 rounded-lg border border-white/25"
                  style={p.gradient ? { background: `linear-gradient(135deg, ${p.gradient[0]}, ${p.gradient[1]})` } : { backdropFilter: 'blur(4px)', background: 'rgba(255,255,255,.18)' }}
                />
                {p.label}
              </button>
            ))}
            <p className="px-2.5 pb-1 pt-2 text-[11px] leading-snug text-white/40">
              Runs on your device. First use downloads the effects engine.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function CtrlButton({ active, onClick, on, off, label, highlightWhenActive = false }) {
  const highlighted = highlightWhenActive ? active : !active;
  return (
    <button
      onClick={onClick}
      title={label}
      /* 44px on a phone (the touch-target floor) so the primary controls and Leave
         fit one row even on a 320px screen; 56 from sm: up. */
      className={cn(
        'grid h-11 w-11 place-items-center rounded-full transition-colors sm:h-14 sm:w-14',
        highlighted ? 'bg-white text-navy-950' : 'bg-white/10 text-white hover:bg-white/20'
      )}
    >
      {active ? on : off}
    </button>
  );
}
