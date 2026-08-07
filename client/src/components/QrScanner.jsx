import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';

/** True when the browser can decode a QR from a video frame natively. */
export const canScanQr = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

/**
 * Camera QR scanner built on the native `BarcodeDetector`.
 *
 * Support is real but partial — Chrome/Edge/Android have it, Safari and iOS do
 * NOT. Rather than ship a ~250KB pure-JS decoder for that case, or show a camera
 * view that silently never resolves, this renders an honest "not supported"
 * state and the caller offers manual code entry instead (`canScanQr()` lets the
 * caller skip mounting this at all).
 *
 * Calls `onResult(text)` once, on the first successful decode.
 */
export default function QrScanner({ onResult, className }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!canScanQr()) {
      setError('This browser cannot scan QR codes. Enter the code manually instead.');
      return undefined;
    }

    let cancelled = false;
    // eslint-disable-next-line no-undef
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

    const tick = async () => {
      if (cancelled || doneRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          const codes = await detector.detect(video);
          const hit = codes?.find((c) => c.rawValue);
          if (hit && !doneRef.current) {
            doneRef.current = true; // fire once, never on every frame
            onResult?.(hit.rawValue);
            return;
          }
        } catch {
          /* a single bad frame is normal — keep scanning */
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => null);
        }
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (!cancelled) {
          setError(
            e?.name === 'NotAllowedError'
              ? 'Camera permission was denied. Enter the code manually instead.'
              : 'Could not start the camera.'
          );
        }
      }
    })();

    // Tracks MUST be stopped here or the camera indicator stays lit after close.
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [onResult]);

  if (error) {
    return (
      <div className={`grid place-items-center gap-2 rounded-2xl neu-inset bg-surface-2 p-6 text-center ${className || ''}`}>
        <CameraOff size={22} className="text-content-muted" />
        <p className="text-xs text-content-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-navy-950 ${className || ''}`}>
      <video ref={videoRef} playsInline muted className="aspect-square w-full object-cover" />
      {/* Reticle — purely a framing hint for the user. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-2/3 w-2/3 rounded-2xl border-2 border-white/70" />
      </div>
      <span className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-white/80">
        <Camera size={12} /> Point at a ChatConnect QR code
      </span>
    </div>
  );
}
