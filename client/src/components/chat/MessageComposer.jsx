import { useRef, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Plus, Smile, Mic, SendHorizontal, X, Image, FileText, MapPin, Camera, Reply, Trash2, Loader2, BarChart3, Eye, Radio, ShoppingBag } from 'lucide-react';
import GifPicker from './GifPicker';
import { useUI } from '../../store/useUI';
import { useChat } from '../../store/useChat';
import { useBusiness } from '../../store/useBusiness';
import { useWorkspace } from '../../store/useWorkspace';
import { emitSocket } from '../../hooks/useSocket';
import { uploadFiles, mediaUrl } from '../../lib/api';
import { cn, formatDuration } from '../../lib/utils';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Switch from '../ui/Switch';

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
  const [showGif, setShowGif] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
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
      if (!attachments.length) throw new Error('empty');
      onSend({ content: '', type, attachments, viewOnce: viewOnceNext && type === 'image' });
      setViewOnceNext(false);
    } catch {
      toast.error('Upload failed. Please try again.');
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

  // ── Camera capture ────────────────────────────────────────────
  const openCamera = async () => {
    setShowAttach(false);
    if (!navigator.mediaDevices?.getUserMedia) return toast.error('Camera is not available.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCameraOpen(true);
      // Attach after the overlay's <video> mounts.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch {
      toast.error('Camera permission denied.');
    }
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    closeCamera();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return;
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
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
    { icon: FileText, label: 'Document', color: 'text-cyan-500 bg-cyan-500/10', onClick: () => docInputRef.current?.click() },
    { icon: MapPin, label: 'Location', color: 'text-emerald-500 bg-emerald-500/10', onClick: shareLocation },
    { icon: Radio, label: 'Live location', color: 'text-rose-500 bg-rose-500/10', onClick: shareLiveLocation },
    { icon: BarChart3, label: 'Poll', color: 'text-amber-500 bg-amber-500/10', onClick: () => { setShowAttach(false); setPollOpen(true); } },
    ...(isTeamWorkspace ? [{ icon: ShoppingBag, label: 'Catalog', color: 'text-brand-500 bg-brand-500/10', onClick: () => { setShowAttach(false); setCatalogOpen(true); } }] : []),
  ];

  return (
    <div className="relative shrink-0 border-t border-border bg-surface/60 px-3 py-3 backdrop-blur-xl sm:px-4">
      {/* hidden file inputs */}
      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => handleFiles(e, 'image')} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple hidden onChange={(e) => handleFiles(e, 'document')} />

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
            className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-content outline-none focus:border-brand-500"
          />
          <div className="space-y-2">
            {poll.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) => setPollOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-content outline-none focus:border-brand-500"
                />
                {poll.options.length > 2 && (
                  <button onClick={() => removePollOption(i)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-content-muted hover:bg-content/5 hover:text-red-500">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {poll.options.length < 12 && (
            <button onClick={addPollOption} className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:underline">
              <Plus size={15} /> Add option
            </button>
          )}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/60 px-3 py-2.5">
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
              <button key={p._id} onClick={() => shareCatalogProduct(p._id)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-2.5 text-left transition-colors hover:bg-content/5">
                {p.images?.[0] ? (
                  <img src={mediaUrl(p.images[0])} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-500"><ShoppingBag size={20} /></span>
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4">
            <video ref={videoRef} playsInline muted className="max-h-[70vh] w-full max-w-lg rounded-2xl bg-black object-contain" />
            <div className="mt-6 flex items-center gap-6">
              <button onClick={closeCamera} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X size={22} /></button>
              <button onClick={capturePhoto} className="h-16 w-16 rounded-full border-4 border-white bg-white/30 transition-transform active:scale-90" aria-label="Capture" />
              <span className="h-12 w-12" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live-location sharing banner */}
      {liveShare && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <Radio size={16} className="animate-pulse text-rose-500" />
          <span className="flex-1 text-xs font-medium text-content">Sharing your live location…</span>
          <button onClick={stopLiveShare} className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-500 hover:bg-rose-500/25">Stop</button>
        </div>
      )}

      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-brand-500 bg-content/5 px-3 py-2">
              <Reply size={15} className="text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-500">Replying to {replyTo.sender?.name || 'yourself'}</p>
                <p className="truncate text-xs text-content-muted">{replyTo.content}</p>
              </div>
              <button onClick={onClearReply} className="text-content-muted hover:text-content"><X size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emoji picker */}
      <AnimatePresence>
        {showEmoji && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-full left-3 mb-2 z-30">
            <EmojiPicker theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT} width={320} height={380} onEmojiClick={(e) => setText((t) => { const next = t + e.emoji; saveDraftDebounced(next); return next; })} lazyLoadEmojis previewConfig={{ showPreview: false }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* GIF picker (Tenor) */}
      <AnimatePresence>
        {showGif && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowGif(false)} />
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-full left-3 z-30 mb-2">
              <GifPicker
                onClose={() => setShowGif(false)}
                onPick={(gif) => { onSend({ content: '', type: 'image', attachments: [gif] }); setShowGif(false); }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Attachment menu */}
      <AnimatePresence>
        {showAttach && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowAttach(false)} />
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="glass-strong absolute bottom-full left-3 z-30 mb-2 grid grid-cols-2 gap-2 rounded-2xl p-3 shadow-soft-lg">
              {menu.map(({ icon: Icon, label, color, onClick }) => (
                <button key={label} onClick={onClick} className="flex w-28 flex-col items-center gap-1.5 rounded-xl p-3 transition-colors hover:bg-content/5">
                  <span className={cn('grid h-11 w-11 place-items-center rounded-full', color)}><Icon size={20} /></span>
                  <span className="text-xs font-medium text-content">{label}</span>
                </button>
              ))}
              <button
                onClick={() => setViewOnceNext((v) => !v)}
                className={cn('col-span-2 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors', viewOnceNext ? 'bg-brand-500/15 text-brand-500' : 'text-content-muted hover:bg-content/5')}
              >
                <Eye size={15} /> {viewOnceNext ? 'View once is ON for the next photo' : 'Send next photo as view once'}
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
            className="glass-strong absolute bottom-full left-3 z-30 mb-2 w-64 overflow-hidden rounded-2xl p-1 shadow-soft-lg"
          >
            {mentionMatches.map((u) => (
              <button
                key={u._id}
                onClick={() => insertMention(u)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-content/5"
              >
                <Avatar src={u.avatar} name={u.name} size="xs" />
                <span className="min-w-0">
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
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2 px-3 py-2.5">
          <button onClick={() => stopRecording(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-red-500 hover:bg-red-500/10" aria-label="Cancel"><Trash2 size={20} /></button>
          <span className="flex items-center gap-2 text-sm font-medium text-content">
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="h-2.5 w-2.5 rounded-full bg-red-500" />
            Recording… {formatDuration(recSeconds)}
          </span>
          <button onClick={() => stopRecording(false)} className="btn-gradient ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" aria-label="Send"><SendHorizontal size={19} /></button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <button onClick={() => { setShowAttach((v) => !v); setShowEmoji(false); }} className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-content-muted transition-all hover:bg-content/5 hover:text-content', showAttach && 'rotate-45 bg-brand-500/10 text-brand-500')} disabled={uploading}>
            {uploading ? <Loader2 size={22} className="animate-spin text-brand-500" /> : <Plus size={22} />}
          </button>

          <div className="flex flex-1 items-end gap-1 rounded-2xl border border-border bg-surface-2 px-2 py-1">
            <button onClick={() => { setShowEmoji((v) => !v); setShowGif(false); setShowAttach(false); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted hover:text-brand-500">
              <Smile size={21} />
            </button>
            <button onClick={() => { setShowGif((v) => !v); setShowEmoji(false); setShowAttach(false); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-content-muted hover:text-brand-500" title="Send a GIF">
              GIF
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Type a message…"
              className="scrollbar-thin max-h-32 flex-1 resize-none bg-transparent py-2.5 text-sm text-content outline-none placeholder:text-content-muted"
            />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {text.trim() ? (
              <motion.button key="send" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} whileTap={{ scale: 0.9 }} onClick={send} className="btn-gradient grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white">
                <SendHorizontal size={20} />
              </motion.button>
            ) : (
              <motion.button key="mic" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} whileTap={{ scale: 0.9 }} onClick={startRecording} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-500 transition-colors hover:bg-brand-500/20" aria-label="Record voice note">
                <Mic size={20} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
