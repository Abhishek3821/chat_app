import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

/**
 * Renders `value` as a QR code onto a canvas.
 *
 * Two deliberate choices worth knowing:
 *
 * 1. `qrcode` is loaded with a dynamic import so its ~50KB never lands in the
 *    initial bundle — a QR is only ever shown behind a deliberate tap.
 * 2. The code is ALWAYS drawn dark-on-white, in both light and dark mode, with a
 *    white quiet zone around it. Theming it navy-on-navy would look tidier and
 *    scan far worse: decoders need the light/dark contrast and the margin to lock
 *    on. So this is the one surface that intentionally ignores the app theme.
 */
export default function QrCode({ value, size = 200, className }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!value) return undefined;

    (async () => {
      try {
        const { default: QRCode } = await import('qrcode');
        if (cancelled || !canvasRef.current) return;
        await QRCode.toCanvas(canvasRef.current, value, {
          width: size,
          margin: 2, // quiet zone — decoders need it
          errorCorrectionLevel: 'M',
          color: { dark: '#0c2c47', light: '#ffffff' }, // palette navy on white
        });
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not render the QR code.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div className={cn('grid place-items-center rounded-2xl bg-surface-2 p-4 text-center', className)} style={{ width: size, height: size }}>
        <p className="text-xs text-content-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn('inline-grid place-items-center rounded-2xl bg-white p-2 shadow-soft', className)}>
      <canvas ref={canvasRef} width={size} height={size} className="block h-auto w-full max-w-full rounded-lg" />
    </div>
  );
}
