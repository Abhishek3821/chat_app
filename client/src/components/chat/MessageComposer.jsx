import { useRef, useState, useEffect, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, Smile, Mic, SendHorizontal, X, Image, FileText, MapPin, Camera, Reply, Trash2, Loader2, BarChart3, Eye, Radio, ShoppingBag, RotateCcw, Video, CalendarClock, Check } from 'lucide-react';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useBusiness } from '../../store/useBusiness';
import { useWorkspace } from '../../store/useWorkspace';
import { emitSocket } from '../../hooks/useSocket';
import { useViewportSize } from '../../hooks/useViewportSize';
import { uploadFiles, mediaUrl } from '../../lib/api';
import { cn, formatDuration } from '../../lib/utils';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import { Textarea } from '../ui/Input';

// Opened rarely (a click toggle, not on mount) and sizable on its own
// (emoji-picker-react ships its full emoji dataset) — loading it only when
// opened keeps it out of the initial bundle entirely.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

// A video "note" is meant to be short; the cap also bounds the upload size.
const VIDEO_NOTE_MAX_SECONDS = 60;

export default function MessageComposer({ chatId, replyTo, onClearReply, onSend, mentionables = [] }) {
  const theme = useUI((s) => s.theme);
  const createPoll = useChat((s) => s.createPoll);
  const startLiveLocation = useChat((s) => s.startLiveLocation);
  const updateLiveLocation = useChat((s) => s.updateLiveLocation);
  const stopLiveLocation = useChat((s) => s.stopLiveLocation);
  const isTeamWorkspace = useWorkspace((s) => s.workspace && s.workspace.type !== 'personal');
  const products = useBusiness((s) => s.products);
  const loadBusiness = useBusiness((s) => s.load);
  const shareProductToChat = useBusiness((s) => s.shareProduct);
  const [liveShare, setLiveShare] = useState(null); // { messageId, watchId } while sharing
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [videoNoteRecording, setVideoNoteRecording] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null); // { blob, url } captured photo awaiting confirm

  // Emoji/GIF popovers are a fixed 320×380 by design, but that overflows past the
  // edge of narrow phones (≤375px) since they're anchored at a fixed left offset.
  // Clamp both dimensions to the actual viewport so they always stay on-screen.
  const viewport = useViewportSize();
  const pickerWidth = Math.min(320, viewport.width - 32);
  const pickerHeight = Math.min(380, Math.round(viewport.height * 0.55));
  const [pollOpen, setPollOpen] = useState(false);
  const [poll, setPoll] = useState({ question: '', options: ['', ''], multi: false });
  const [viewOnceNext, setViewOnceNext] = useState(false); // send the next photo as view-once
  const [mention, setMention] = useState(null); // { query, start } while typing an @mention

  const typingTimeout = useRef(null);
  const lastTypingEmit = useRef(0);
  const draftTimer = useRef(null);
  const photoInputRef = useRef(null);
  const docInputRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recTimerRef = useRef(null);
  const recSecondsRef = useRef(0);
  const cancelledRef = useRef(false);
  const videoRef = useRef(null);
  const videoNoteRef = useRef(null);
  const textareaRef = useRef(null);
  const liveWatchRef = useRef(null);
  const liveShareMsgRef = useRef(null); // live-location messageId, for unmount cleanup

  // ── Draft persistence (per chat, survives navigation & reload) ──
  useEffect(() => {
    setText(localStorage.getItem(`cc_draft_${chatId}`) || '');
    setMention(null);
  }, [chatId]);

  const saveDraft = (val) => {
    clearTimeout(draftTimer.current); // a pending debounced write must not resurrect stale text
    if (val) localStorage.setItem(`cc_draft_${chatId}`, val);
    else localStorage.removeItem(`cc_draft_${chatId}`);
  };
  // Keystroke path: defer the synchronous localStorage write so typing never
  // stutters on storage I/O. Immediate saveDraft stays for send/insertMention.
  const saveDraftDebounced = (val) => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(val), 400);
  };

  // ── @mention autocomplete ──────────────────────────────────────
  const detectMention = (val, caret) => {
    if (!mentionables.length) return setMention(null);
    const upto = val.slice(0, caret ?? val.length);
    const m = upto.match(/(?:^|\s)@([A-Za-z0-9_.]*)$/);
    setMention(m ? { query: m[1].toLowerCase(), start: caret - m[1].length - 1 } : null);
  };
  const mentionMatches = mention
    ? mentionables
        .filter((u) => `${u.username || ''} ${u.name || ''}`.toLowerCase().includes(mention.query))
        .slice(0, 6)
    : [];
  const insertMention = (user) => {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${user.username} ${text.slice(caret)}`;
    setText(next);
    saveDraft(next);
    setMention(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // Clean up any live mic/camera stream + timer if the composer unmounts mid-record.
  useEffect(() => () => {
    clearInterval(recTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (liveWatchRef.current != null) navigator.geolocation?.clearWatch(liveWatchRef.current);
    // Switching chats mid live-share: stop the SERVER share too, otherwise
    // peers keep seeing a "live" location that no longer updates.
    if (liveShareMsgRef.current) {
      stopLiveLocation(liveShareMsgRef.current);
      liveShareMsgRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach the live camera stream to whichever preview <video> is on screen.
  //
  // Both previews live behind a conditional (`videoNoteRecording` / `cameraOpen`),
  // so their <video> does NOT exist yet while getUserMedia is being handled —
  // assigning srcObject there hit a null ref and was silently skipped, which is
  // why the video-note bubble showed no self-preview at all. An effect runs after
  // React commits the DOM, so the element is guaranteed to be mounted here.
  useEffect(() => {
    const el = videoNoteRecording ? videoNoteRef.current : cameraOpen ? videoRef.current : null;
    const stream = streamRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    // Some browsers won't start a freshly-attached stream without an explicit
    // play() even with autoPlay; the rejection is harmless (e.g. unmounted).
    el.play().catch(() => {});
  }, [videoNoteRecording, cameraOpen]);

  // Business users: make sure the catalog is loaded for the share picker.
  useEffect(() => { if (isTeamWorkspace) loadBusiness(); }, [isTeamWorkspace, loadBusiness]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    saveDraftDebounced(val);
    detectMention(val, e.target.selectionStart);
    // Throttle typing-start to one emit per second — the peer's indicator only
    // needs renewing, not one socket packet per character typed.
    const now = Date.now();
    if (now - lastTypingEmit.current > 1000) {
      lastTypingEmit.current = now;
      emitSocket('typing-start', { chatId });
    }
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      lastTypingEmit.current = 0;
      emitSocket('typing-stop', { chatId });
    }, 1500);
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onSend({ content: value, type: 'text', replyTo });
    setText('');
    saveDraft('');
    setShowEmoji(false);
    setMention(null);
    onClearReply?.();
    emitSocket('typing-stop', { chatId });
  };

  // ── Poll creation ──────────────────────────────────────────────
  const setPollOption = (i, val) => setPoll((p) => ({ ...p, options: p.options.map((o, j) => (j === i ? val : o)) }));
  const addPollOption = () => setPoll((p) => (p.options.length >= 12 ? p : { ...p, options: [...p.options, ''] }));
  const removePollOption = (i) => setPoll((p) => ({ ...p, options: p.options.filter((_, j) => j !== i) }));
  const submitPoll = async () => {
    const question = poll.question.trim();
    const options = poll.options.map((o) => o.trim()).filter(Boolean);
    if (!question) return toast.error('Add a question for your poll.');
    if (options.length < 2) return toast.error('A poll needs at least two options.');
    try {
      await createPoll({ chatId, question, options, multi: poll.multi });
      setPollOpen(false);
      setPoll({ question: '', options: ['', ''], multi: false });
    } catch {
      toast.error('Could not create the poll.');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── Files (photo / document) ──────────────────────────────────
  const handleFiles = async (e, type) => {
    const files = [...(e.target.files || [])];
    e.target.value = ''; // allow re-picking the same file
    setShowAttach(false);
    if (!files.length) return;
    setUploading(true);
    try {
      const attachments = await uploadFiles(files);
      if (!attachments.length) throw new Error('Upload failed. Please try again.');
      onSend({ content: '', type, attachments, viewOnce: viewOnceNext && type === 'image' });
      setViewOnceNext(false);
    } catch (err) {
      // Show the real reason ("… is 78 MB — the limit is 50 MB") instead of a
      // generic failure; the old bare catch threw that information away.
      toast.error(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const shareLocation = () => {
    setShowAttach(false);
    if (!navigator.geolocation) return toast.error('Location is not available.');
    navigator.geolocation.getCurrentPosition(
      (pos) => onSend({ content: '', type: 'location', location: { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Shared location' } }),
      () => toast.error('Could not get your location.')
    );
  };

  // ── Live location: share for 1h, streaming updates until stopped/expired ──
  const shareLiveLocation = () => {
    setShowAttach(false);
    if (liveShare) return; // already sharing in this chat
    if (!navigator.geolocation) return toast.error('Location is not available.');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const message = await startLiveLocation(chatId, coords, 3600);
          const watchId = navigator.geolocation.watchPosition(
            (p) => updateLiveLocation(message._id, { lat: p.coords.latitude, lng: p.coords.longitude }),
            () => {},
            { enableHighAccuracy: true, maximumAge: 10000 }
          );
          liveWatchRef.current = watchId;
          liveShareMsgRef.current = message._id;
          setLiveShare({ messageId: message._id, watchId });
          toast.success('Sharing live location for 1 hour.');
        } catch (err) {
          toast.error(err?.message || 'Could not start live location.');
        }
      },
      () => toast.error('Could not get your location.')
    );
  };
  const stopLiveShare = async () => {
    if (!liveShare) return;
    navigator.geolocation?.clearWatch(liveShare.watchId);
    liveWatchRef.current = null;
    liveShareMsgRef.current = null;
    await stopLiveLocation(liveShare.messageId);
    setLiveShare(null);
    toast('Stopped sharing live location.');
  };

  const shareCatalogProduct = async (productId) => {
    setCatalogOpen(false);
    try {
      await shareProductToChat(productId, chatId);
    } catch (err) {
      toast.error(err?.message || 'Could not share product.');
    }
  };

  // ── Voice recording ───────────────────────────────────────────
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast.error('Voice recording is not supported in this browser.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      cancelledRef.current = false;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      recorder.onstop = async () => {
        clearInterval(recTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        const seconds = recSecondsRef.current; // ref → latest value (state would be stale in this closure)
        setRecording(false);
        setRecSeconds(0);
        if (cancelledRef.current) return;
        const mime = recorder.mimeType || 'audio/webm';
        const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('mpeg') ? 'm4a' : 'webm';
        const file = new File([new Blob(chunksRef.current, { type: mime })], `voice-${Date.now()}.${ext}`, { type: mime });
        setUploading(true);
        try {
          const attachments = await uploadFiles([file]);
          onSend({ content: '', type: 'voice', attachments: attachments.map((a) => ({ ...a, duration: seconds })) });
        } catch {
          toast.error('Could not send voice note.');
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      setRecording(true);
      setRecSeconds(0);
      recSecondsRef.current = 0;
      recTimerRef.current = setInterval(() => {
        recSecondsRef.current += 1;
        setRecSeconds(recSecondsRef.current);
      }, 1000);
    } catch {
      toast.error('Microphone permission denied.');
    }
  };

  const stopRecording = (cancel) => {
    cancelledRef.current = !!cancel;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  // ── Video notes (Telegram-style round clips) ──────────────────
  // Same shape as the voice flow above — including stopping every track in
  // `onstop`, which is what keeps the camera light from staying on.
  const startVideoNote = async () => {
    setShowAttach(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast.error('Video notes are not supported in this browser.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Square-ish request so the circular crop doesn't cut off faces.
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: true,
      });
      streamRef.current = stream;
      cancelledRef.current = false;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      // The preview <video> doesn't exist until setVideoNoteRecording(true) below
      // renders it — the effect above attaches the stream once it's mounted.
      recorder.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      recorder.onstop = async () => {
        clearInterval(recTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoNoteRef.current) videoNoteRef.current.srcObject = null;
        const seconds = recSecondsRef.current;
        setVideoNoteRecording(false);
        setRecSeconds(0);
        if (cancelledRef.current) return;
        const mime = recorder.mimeType || 'video/webm';
        const file = new File([new Blob(chunksRef.current, { type: mime })], `videonote-${Date.now()}.webm`, { type: mime });
        setUploading(true);
        try {
          const attachments = await uploadFiles([file]);
          onSend({ content: '', type: 'videoNote', attachments: attachments.map((a) => ({ ...a, duration: seconds })) });
        } catch {
          toast.error('Could not send video note.');
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      setVideoNoteRecording(true);
      setRecSeconds(0);
      recSecondsRef.current = 0;
      recTimerRef.current = setInterval(() => {
        recSecondsRef.current += 1;
        setRecSeconds(recSecondsRef.current);
        // Hard cap — a "note" is short, and it also bounds the upload size.
        if (recSecondsRef.current >= VIDEO_NOTE_MAX_SECONDS) stopVideoNote(false);
      }, 1000);
    } catch {
      toast.error('Camera/microphone permission denied.');
    }
  };

  const stopVideoNote = (cancel) => {
    cancelledRef.current = !!cancel;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  // ── Camera capture ────────────────────────────────────────────
  const openCamera = async () => {
    setShowAttach(false);
    if (!navigator.mediaDevices?.getUserMedia) return toast.error('Camera is not available.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCameraOpen(true);
      // The stream is attached by the effect above once the overlay's <video>
      // mounts. This used to be a setTimeout(…, 50) race, which could miss on a
      // slow device and leave the camera preview black.
    } catch {
      toast.error('Camera permission denied.');
    }
  };

  const clearSnapshot = () => {
    setSnapshot((s) => {
      if (s) URL.revokeObjectURL(s.url);
      return null;
    });
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    clearSnapshot();
    setCameraOpen(false);
  };

  // Capture freezes the frame into a preview; the stream stays live so Retake is instant.
  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return toast.error('Could not capture photo.');
    setSnapshot({ blob, url: URL.createObjectURL(blob) });
  };

  const sendSnapshot = async () => {
    if (!snapshot) return;
    const file = new File([snapshot.blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    closeCamera();
    setUploading(true);
    try {
      const attachments = await uploadFiles([file]);
      onSend({ content: '', type: 'image', attachments, viewOnce: viewOnceNext });
      setViewOnceNext(false);
    } catch {
      toast.error('Could not send photo.');
    } finally {
      setUploading(false);
    }
  };

  const menu = [
    { icon: Image, label: 'Photo', color: 'text-violet-500 bg-violet-500/10', onClick: () => photoInputRef.current?.click() },
    { icon: Camera, label: 'Camera', color: 'text-brand-500 bg-brand-500/10', onClick: openCamera },
    { icon: Video, label: 'Video note', color: 'text-brand-500 bg-brand-500/10', onClick: startVideoNote },
    { icon: FileText, label: 'Document', color: 'text-cyan-500 bg-cyan-500/10', onClick: () => docInputRef.current?.click() },
    { icon: MapPin, label: 'Location', color: 'text-emerald-500 bg-emerald-500/10', onClick: shareLocation },
    { icon: Radio, label: 'Live location', color: 'text-rose-500 bg-rose-500/10', onClick: shareLiveLocation },
    { icon: BarChart3, label: 'Poll', color: 'text-amber-500 bg-amber-500/10', onClick: () => { setShowAttach(false); setPollOpen(true); } },
    { icon: CalendarClock, label: 'Schedule', color: 'text-cyan-500 bg-cyan-500/10', onClick: () => { setShowAttach(false); setScheduleOpen(true); } },
    ...(isTeamWorkspace ? [{ icon: ShoppingBag, label: 'Catalog', color: 'text-brand-500 bg-brand-500/10', onClick: () => { setShowAttach(false); setCatalogOpen(true); } }] : []),
  ];

  return (
    // The chat route is the one page AppLayout does NOT bottom-pad (chat owns its
    // own columns). Only the home-indicator inset is needed here — MobileNav
    // unmounts while a conversation is open, so there is no 68px bar to clear.
    <div className="frost neu-rail-top relative z-10 shrink-0 border-t border-border/70 px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-4 md:pb-3">
      {/* hidden file inputs */}
      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => handleFiles(e, 'image')} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple hidden onChange={(e) => handleFiles(e, 'document')} />

      {/* Video-note recorder — circular live preview, matching how it will send. */}
      <AnimatePresence>
        {videoNoteRecording && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass-strong absolute inset-x-2 bottom-full z-30 mb-2 flex flex-col items-center gap-3 rounded-3xl p-4 sm:inset-x-4"
          >
            <div className="relative h-40 w-40 overflow-hidden rounded-full shadow-soft-lg ring-4 ring-brand-500/30 xs:h-48 xs:w-48">
              {/* Mirrored like a mirror (what every self-view does) — this is a CSS
                  transform on the element, so the RECORDED clip is unaffected.
                  muted is required: unmuted would howl through the mic feedback. */}
              <video
                ref={videoNoteRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full scale-x-[-1] object-cover"
              />
            </div>
            <p className="text-sm font-semibold tabular-nums text-content">
              {formatDuration(recSeconds)} <span className="text-content-muted">/ {formatDuration(VIDEO_NOTE_MAX_SECONDS)}</span>
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => stopVideoNote(true)}
                className="neu-raised-sm neu-press grid h-12 w-12 place-items-center rounded-full bg-surface text-red-500"
                aria-label="Discard video note"
              >
                <Trash2 size={20} />
              </button>
              <button
                onClick={() => stopVideoNote(false)}
                className="btn-gradient grid h-14 w-14 place-items-center rounded-full text-white"
                aria-label="Send video note"
              >
                <Check size={22} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        chatId={chatId}
        text={text}
        replyTo={replyTo}
        onScheduled={(usedComposerText) => {
          // Only wipe the composer when the scheduled message WAS its text —
          // otherwise typing something new in the dialog would silently discard
          // an unrelated draft the user still intends to send.
          if (usedComposerText) {
            setText('');
            saveDraft('');
            onClearReply?.();
          }
        }}
      />

      {/* Poll creator */}
      <Modal
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        title="Create a poll"
        subtitle="Ask the chat a question."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPollOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submitPoll}><BarChart3 size={16} /> Create poll</Button>
          </div>
        }
      >
        <div className="space-y-3 py-1">
          <input
            value={poll.question}
            onChange={(e) => setPoll((p) => ({ ...p, question: e.target.value }))}
            placeholder="Question"
            className="neu-inset w-full rounded-2xl bg-surface-2 px-3 py-2.5 text-sm text-content outline-none"
          />
          <div className="space-y-2">
            {poll.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) => setPollOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  // min-w-0: an <input>'s intrinsic min-width would otherwise keep
                  // this flex row wider than the modal on a narrow phone.
                  className="neu-inset min-w-0 flex-1 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-content outline-none"
                />
                {poll.options.length > 2 && (
                  <button onClick={() => removePollOption(i)} className="neu-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-content-muted hover:bg-content/5 hover:text-red-500 sm:h-8 sm:w-8">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {poll.options.length < 12 && (
            <button onClick={addPollOption} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
              <Plus size={15} /> Add option
            </button>
          )}
          <label className="neu-inset flex items-center justify-between gap-3 rounded-2xl bg-surface-2/60 px-3 py-2.5">
            <span className="text-sm text-content">Allow multiple answers</span>
            <Switch checked={poll.multi} onChange={(v) => setPoll((p) => ({ ...p, multi: v }))} />
          </label>
        </div>
      </Modal>

      {/* Catalog product picker (business) */}
      <Modal open={catalogOpen} onClose={() => setCatalogOpen(false)} title="Share a product" subtitle="Send an item from your catalog." size="md">
        <div className="space-y-2 py-1">
          {products.length === 0 ? (
            <p className="py-8 text-center text-sm text-content-muted">No products yet. Add them under Business → Catalog.</p>
          ) : (
            products.map((p) => (
              <button key={p._id} onClick={() => shareCatalogProduct(p._id)} className="neu-hover flex w-full items-center gap-3 rounded-2xl bg-surface-2/60 p-2.5 text-left">
                {p.images?.[0] ? (
                  <img src={mediaUrl(p.images[0])} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="neu-inset grid h-12 w-12 shrink-0 place-items-center rounded-xl text-brand-600 dark:text-brand-300"><ShoppingBag size={20} /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-content">{p.name}</span>
                  {p.price ? <span className="block text-xs text-brand-600 dark:text-brand-300">{p.currency} {p.price}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* Camera overlay */}
      <AnimatePresence>
        {cameraOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-safe fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-3 sm:p-4">
            {/* Keep the <video> mounted (hidden) during preview so the stream survives Retake. */}
            {/* Not mirrored: these frames are what capturePhoto() draws to the
                canvas, so preview and captured photo must match. */}
            <video ref={videoRef} autoPlay playsInline muted className={cn('max-h-[62dvh] w-full max-w-lg rounded-2xl bg-black object-contain sm:max-h-[70dvh] 2xl:max-w-2xl', snapshot && 'hidden')} />
            {snapshot && (
              <img src={snapshot.url} alt="Captured" className="max-h-[62dvh] w-full max-w-lg rounded-2xl bg-black object-contain sm:max-h-[70dvh] 2xl:max-w-2xl" />
            )}
            {snapshot ? (
              <div className="mt-5 flex items-center gap-4 sm:mt-6 sm:gap-6">
                <button onClick={closeCamera} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close"><X size={22} /></button>
                <button onClick={clearSnapshot} className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/20 sm:px-5">
                  <RotateCcw size={18} /> Retake
                </button>
                <button onClick={sendSnapshot} className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-lg transition-transform hover:bg-brand-600 active:scale-90" aria-label="Send photo">
                  <SendHorizontal size={22} />
                </button>
              </div>
            ) : (
              <div className="mt-5 flex items-center gap-6 sm:mt-6">
                <button onClick={closeCamera} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close"><X size={22} /></button>
                <button onClick={capturePhoto} className="h-16 w-16 shrink-0 rounded-full border-4 border-white bg-white/30 transition-transform active:scale-90" aria-label="Capture" />
                <span className="h-12 w-12 shrink-0" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live-location sharing banner */}
      {liveShare && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <Radio size={16} className="shrink-0 animate-pulse text-rose-500" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-content">Sharing your live location…</span>
          <button onClick={stopLiveShare} className="neu-press shrink-0 rounded-full bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-500/25">Stop</button>
        </div>
      )}

      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="neu-inset-sm mb-2 flex items-center gap-2 rounded-xl border-l-2 border-brand-500 bg-surface-2 px-3 py-2">
              <Reply size={15} className="shrink-0 text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-brand-600 dark:text-brand-300">Replying to {replyTo.sender?.name || 'yourself'}</p>
                <p className="truncate text-xs text-content-muted">{replyTo.content}</p>
              </div>
              <button onClick={onClearReply} className="neu-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-content-muted hover:bg-content/5 hover:text-content"><X size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emoji picker — lazy-loaded (its dataset only needs to download once opened) */}
      <AnimatePresence>
        {showEmoji && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-full left-3 z-30 mb-2">
            <Suspense fallback={<div style={{ width: pickerWidth, height: pickerHeight }} className="glass-strong grid place-items-center rounded-2xl"><Loader2 size={22} className="animate-spin text-brand-500" /></div>}>
              <EmojiPicker theme={theme === 'dark' ? 'dark' : 'light'} width={pickerWidth} height={pickerHeight} onEmojiClick={(e) => setText((t) => { const next = t + e.emoji; saveDraftDebounced(next); return next; })} lazyLoadEmojis previewConfig={{ showPreview: false }} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment menu */}
      <AnimatePresence>
        {showAttach && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowAttach(false)} />
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="glass-strong absolute bottom-full left-3 z-30 mb-2 grid max-w-[calc(100vw-1.5rem)] grid-cols-2 gap-2 rounded-3xl p-2.5 sm:grid-cols-3 sm:p-3">
              {menu.map(({ icon: Icon, label, color, onClick }) => (
                <button key={label} onClick={onClick} className="neu-raised-sm neu-press flex w-24 flex-col items-center gap-1.5 rounded-2xl bg-surface p-2.5 xs:w-28 sm:p-3">
                  <span className={cn('grid h-11 w-11 place-items-center rounded-full shadow-glow', color)}><Icon size={20} /></span>
                  <span className="max-w-full truncate text-xs font-medium text-content">{label}</span>
                </button>
              ))}
              <button
                onClick={() => setViewOnceNext((v) => !v)}
                className={cn('neu-press col-span-2 flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-center text-xs font-semibold sm:col-span-3 sm:py-2', viewOnceNext ? 'neu-inset-sm bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'neu-raised-sm bg-surface text-content-muted')}
              >
                <Eye size={15} className="shrink-0" /> {viewOnceNext ? 'View once is ON for the next photo' : 'Send next photo as view once'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* @mention autocomplete */}
      <AnimatePresence>
        {mentionMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass-strong absolute bottom-full left-3 z-30 mb-2 w-[min(16rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl p-1"
          >
            {mentionMatches.map((u) => (
              <button
                key={u._id}
                onClick={() => insertMention(u)}
                className="neu-hover flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
              >
                <Avatar src={u.avatar} name={u.name} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-content">{u.name}</span>
                  <span className="block truncate text-xs text-content-muted">@{u.username}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {recording ? (
        // ── Recording bar ──
        <div className="neu-inset flex items-center gap-2 rounded-[22px] px-2 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
          <button onClick={() => stopRecording(true)} className="neu-press grid h-11 w-11 shrink-0 place-items-center rounded-full text-red-500 hover:bg-red-500/10 sm:h-10 sm:w-10" aria-label="Cancel"><Trash2 size={20} /></button>
          <span className="flex min-w-0 items-center gap-2 truncate text-xs font-medium text-content sm:text-sm">
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
            Recording… {formatDuration(recSeconds)}
          </span>
          <button onClick={() => stopRecording(false)} className="btn-gradient ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full text-white sm:h-10 sm:w-10" aria-label="Send"><SendHorizontal size={19} /></button>
        </div>
      ) : (
        <div className="flex min-w-0 items-end gap-1.5 sm:gap-2">
          {/* The + is a raised key; while its tray is open it presses in, which
              is the whole point of the soft-UI language — state you can read
              from the depth, not just the colour. */}
          <button
            onClick={() => { setShowAttach((v) => !v); setShowEmoji(false); }}
            className={cn(
              'neu-press grid h-11 w-11 shrink-0 place-items-center rounded-full transition-all',
              showAttach ? 'neu-inset-sm rotate-45 bg-surface-2 text-brand-600 dark:text-brand-300' : 'neu-raised-sm bg-surface text-content-muted hover:text-content'
            )}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={22} className="animate-spin text-brand-500" /> : <Plus size={22} />}
          </button>

          <div className="neu-inset flex min-w-0 flex-1 items-end gap-0.5 rounded-[22px] px-1.5 py-1 sm:gap-1 sm:px-2">
            <button onClick={() => { setShowEmoji((v) => !v); setShowAttach(false); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-content-muted transition-colors hover:bg-content/5 hover:text-brand-500 sm:h-9 sm:w-9">
              <Smile size={21} />
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Type a message…"
              className="scrollbar-thin max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-sm text-content outline-none placeholder:text-content-muted"
            />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {text.trim() ? (
              <motion.button key="send" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} whileTap={{ scale: 0.9 }} onClick={send} className="btn-gradient grid h-11 w-11 shrink-0 place-items-center rounded-full text-white">
                <SendHorizontal size={20} />
              </motion.button>
            ) : (
              <motion.button key="mic" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} whileTap={{ scale: 0.9 }} onClick={startRecording} className="neu-raised-sm grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300" aria-label="Record voice note">
                <Mic size={20} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/**
 * Schedule the composer's current text for later, and manage what's already queued.
 *
 * Pending rows deliberately live in their own store slice (`scheduledByChat`),
 * not in `messagesByChat` — they aren't messages yet, and mixing them in would
 * put unsent text into history, search and unread counts.
 */
/** 'YYYY-MM-DDTHH:mm' in LOCAL time — what `datetime-local` expects.
 *  toISOString() would be wrong here: it shifts the value by the UTC offset. */
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One-tap times, so the common cases don't need the date picker at all. */
function quickTimes() {
  const now = new Date();
  const inHours = (h) => new Date(now.getTime() + h * 3600_000);
  const at = (dayOffset, hour) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const tonight = at(0, 20);
  return [
    { label: 'In 1 hour', date: inHours(1) },
    { label: 'In 3 hours', date: inHours(3) },
    // Only offer "tonight" while it is still ahead of us.
    ...(tonight.getTime() > now.getTime() + 60_000 ? [{ label: 'Tonight, 8 PM', date: tonight }] : []),
    { label: 'Tomorrow, 9 AM', date: at(1, 9) },
  ];
}

function ScheduleModal({ open, onClose, chatId, text, replyTo, onScheduled }) {
  const scheduled = useChat((s) => s.scheduledByChat[chatId]) || [];
  const loadScheduled = useChat((s) => s.loadScheduled);
  const scheduleMessage = useChat((s) => s.scheduleMessage);
  const cancelScheduled = useChat((s) => s.cancelScheduled);
  const [when, setWhen] = useState('');
  // The message is EDITED HERE, seeded from the composer. It used to be a
  // read-only echo of the composer's text, with the Schedule button disabled
  // whenever that was empty — so opening Attach → Schedule (which is what you
  // do *before* typing) gave you a dead dialog telling you to go type first.
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    if (!open) return;
    loadScheduled(chatId);
    setBody(text || '');
    setWhen(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setPresets(quickTimes()); // computed on open so "tonight" is relative to now
  }, [open, chatId, text, loadScheduled]);

  const submit = async () => {
    const content = body.trim();
    if (!content) return toast.error('Write the message you want to send later.');
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return toast.error('Pick a valid date and time.');
    // Matches the server's MIN_SCHEDULE_LEAD_MS, so the common mistake is caught
    // here with a useful sentence instead of bouncing off a 400.
    if (at.getTime() - Date.now() < 10_000) return toast.error('Pick a time at least a minute from now.');
    setBusy(true);
    try {
      await scheduleMessage({ chatId, sendAt: at.toISOString(), content, type: 'text', replyTo });
      toast.success(`Scheduled for ${at.toLocaleString()}`);
      // Only clear the composer if this message actually came from it.
      onScheduled?.(content === (text || '').trim());
      onClose?.();
    } catch (e) {
      toast.error(e?.message || 'Could not schedule that message.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule message"
      subtitle="It'll be sent automatically, even if you're offline."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !body.trim()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />} Schedule
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">Message</p>
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should we send?"
            autoFocus
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">Send at</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const value = toLocalInput(p.date);
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setWhen(value)}
                  className={cn(
                    'neu-press rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
                    when === value ? 'bg-brand-gradient text-white shadow-glow' : 'neu-raised-sm bg-surface text-content-muted'
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <input
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date(Date.now() + 60_000))}
            onChange={(e) => setWhen(e.target.value)}
            className="neu-inset ring-brand h-11 w-full rounded-2xl bg-surface-2 px-3 text-base text-content disabled:opacity-50 sm:h-10 sm:text-sm"
          />
          {when && !Number.isNaN(new Date(when).getTime()) && (
            <p className="mt-1.5 text-xs text-content-muted">
              Sends {new Date(when).toLocaleString()} · within about a minute of that time.
            </p>
          )}
        </div>

        {scheduled.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
              Already scheduled ({scheduled.length})
            </p>
            <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto">
              {scheduled.map((row) => (
                <div key={row._id} className="neu-inset-sm flex items-center gap-2 rounded-2xl bg-surface-2/60 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{row.content || `(${row.type})`}</p>
                    <p className="truncate text-xs text-content-muted">
                      {new Date(row.sendAt).toLocaleString()}
                      {row.status === 'failed' && <span className="ml-1.5 font-semibold text-red-500">· failed</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => cancelScheduled(chatId, row._id).catch((e) => toast.error(e?.message || 'Could not cancel.'))}
                    className="neu-press grid h-10 w-10 shrink-0 place-items-center rounded-full text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 sm:h-9 sm:w-9"
                    aria-label="Cancel scheduled message"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
