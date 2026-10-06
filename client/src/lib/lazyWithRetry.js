import { lazy } from 'react';

const RELOAD_FLAG = 'ck:chunk-reload';

/**
 * `React.lazy` that survives a failed chunk fetch.
 *
 * The first visit to a code-split tab can fail to load its chunk — in dev when
 * Vite re-optimizes newly discovered deps (old module URLs go stale), and in
 * production when a redeploy removed the old hashed files. Plain `lazy()` then
 * throws into the ErrorBoundary ("Something went sideways").
 *
 * We retry the import once, and if it still fails do a single hard reload to
 * pick up fresh assets. A sessionStorage flag prevents a reload loop.
 */
export default function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
      return mod;
    } catch (err) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await factory();
      } catch {
        let reloaded = false;
        try { reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* ignore */ }
        if (!reloaded) {
          try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* ignore */ }
          window.location.reload();
          // Keep suspending until the reload happens.
          return new Promise(() => {});
        }
        throw err;
      }
    }
  });
}
