import { useState, useEffect } from 'react';

/**
 * Live viewport dimensions, updated on resize/orientation change. Used to clamp
 * fixed-size popovers (emoji/GIF pickers, etc.) so they never render wider or
 * taller than the actual screen — a real problem on narrow phones (≤375px)
 * where a hardcoded 320px-wide popover can overflow past the edge.
 */
export function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 375,
    height: typeof window !== 'undefined' ? window.innerHeight : 667,
  }));

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return size;
}
