/**
 * Local meeting recorder: composites every participant's video onto a canvas,
 * mixes all audio, and records to a downloadable .webm. Transport-agnostic —
 * it just needs a getStreams() that returns the current MediaStreams. Used by
 * the LiveKit (SFU) meeting hook; the mesh hook has its own inline copy.
 */
export function createMeetingRecorder({ getStreams, fileName = 'meeting.webm' }) {
  let ctx = null; // { recorder, audioCtx, raf }

  const start = () => {
    if (ctx || typeof MediaRecorder === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const c = canvas.getContext('2d');
      const videoEls = new Map();
      const elFor = (stream) => {
        if (!stream) return null;
        let el = videoEls.get(stream.id);
        if (!el) {
          el = document.createElement('video');
          el.srcObject = stream;
          el.muted = true;
          el.playsInline = true;
          el.play().catch(() => {});
          videoEls.set(stream.id, el);
        }
        return el;
      };
      const draw = () => {
        const streams = getStreams().filter(Boolean);
        const n = Math.max(1, streams.length);
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        c.fillStyle = '#0b1220';
        c.fillRect(0, 0, canvas.width, canvas.height);
        const cw = canvas.width / cols;
        const ch = canvas.height / rows;
        streams.forEach((s, i) => {
          const el = elFor(s);
          if (el && el.readyState >= 2) {
            try { c.drawImage(el, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch); } catch { /* noop */ }
          }
        });
        if (ctx) ctx.raf = requestAnimationFrame(draw);
      };
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const dest = audioCtx.createMediaStreamDestination();
      getStreams().forEach((s) => {
        if (s?.getAudioTracks().length) {
          try { audioCtx.createMediaStreamSource(s).connect(dest); } catch { /* noop */ }
        }
      });
      const mixed = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const recorder = new MediaRecorder(mixed, { mimeType: mime });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        try {
          const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch { /* noop */ }
      };
      ctx = { recorder, audioCtx, raf: 0 };
      draw();
      recorder.start(1000);
      return true;
    } catch {
      ctx = null;
      return false;
    }
  };

  const stop = () => {
    const r = ctx;
    if (!r) return;
    ctx = null;
    cancelAnimationFrame(r.raf);
    try { if (r.recorder.state !== 'inactive') r.recorder.stop(); } catch { /* noop */ }
    try { r.audioCtx.close(); } catch { /* noop */ }
  };

  return { start, stop, isActive: () => !!ctx };
}
