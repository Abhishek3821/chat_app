import { useRef, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Plus, Smile, Mic, SendHorizontal, X, Image, FileText, MapPin, Camera, Reply, Trash2, Loader2 } from 'lucide-react';
import { useUI } from '../../store/useUI';
import { emitSocket } from '../../hooks/useSocket';
import { uploadFiles } from '../../lib/api';
import { cn, formatDuration } from '../../lib/utils';

export default function MessageComposer({ chatId, replyTo, onClearReply, onSend }) {
  const theme = useUI((s) => s.theme);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);

  const typingTimeout = useRef(null);
  const photoInputRef = useRef(null);
  const docInputRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recTimerRef = useRef(null);
  const recSecondsRef = useRef(0);
  const cancelledRef = useRef(false);
  const videoRef = useRef(null);

  // Clean up any live mic/camera stream + timer if the composer unmounts mid-record.
  useEffect(() => () => {
    clearInterval(recTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const handleChange = (e) => {
    setText(e.target.value);
    emitSocket('typing-start', { chatId });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitSocket('typing-stop', { chatId }), 1500);
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onSend({ content: value, type: 'text', replyTo });
    setText('');
    setShowEmoji(false);
    onClearReply?.();
    emitSocket('typing-stop', { chatId });
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
      onSend({ content: '', type, attachments });
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
      onSend({ content: '', type: 'image', attachments });
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
  ];

  return (
    <div className="relative shrink-0 border-t border-border bg-surface/60 px-3 py-3 backdrop-blur-xl sm:px-4">
      {/* hidden file inputs */}
      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => handleFiles(e, 'image')} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple hidden onChange={(e) => handleFiles(e, 'document')} />

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
            <EmojiPicker theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT} width={320} height={380} onEmojiClick={(e) => setText((t) => t + e.emoji)} lazyLoadEmojis previewConfig={{ showPreview: false }} />
          </motion.div>
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
            </motion.div>
          </>
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
            <button onClick={() => { setShowEmoji((v) => !v); setShowAttach(false); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted hover:text-brand-500">
              <Smile size={21} />
            </button>
            <textarea
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
