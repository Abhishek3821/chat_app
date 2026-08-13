import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Split heavy libraries into their own vendor chunks. This silences Vite's
    // "chunk larger than 500 kB" advisory and improves caching — the charts
    // bundle (admin-only) and animation lib no longer bloat the main bundle.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Only split off leaf libraries (they depend on React but nothing
        // depends back on them), so no circular chunk is created. React stays
        // in the main vendor chunk.
        // ALLOWLIST, never a blanket fallback.
        //
        // A manualChunks assignment OVERRIDES Rollup's automatic chunking for
        // dynamically-imported modules, so naming a chunk for a library turns it
        // into a static chunk in the entry graph — which index.html then
        // modulepreloads on every page load, silently defeating `lazy()`. That
        // has now bitten this project twice: once with emoji-picker-react, and
        // again with recharts (~102 kB gzip of admin-only charting eagerly
        // preloaded for every user), plus ~32 kB of its transitive deps that the
        // old `return 'vendor'` fallback swept in.
        //
        // So: only libraries that are genuinely part of the FIRST paint get a
        // named chunk. Everything else returns undefined and Rollup places it
        // with whichever async chunk actually imports it. Adding a new heavy,
        // lazily-used dependency now needs no config change at all.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // Eager: imported by the shell (router, layout, stores, HTTP, sockets).
          // react/react-dom must share one chunk — two copies breaks hooks.
          if (
            /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id) ||
            /node_modules\/(axios|zustand|socket\.io-client|engine\.io-client|date-fns|clsx|tailwind-merge|lucide-react|react-hot-toast)\//.test(id)
          ) {
            return 'vendor';
          }
          // framer-motion animates the shell itself, so it is first-paint work.
          if (id.includes('framer-motion')) return 'motion';

          // Everything else (recharts/d3, livekit, emoji-picker-react, qrcode, …)
          // is only reachable through a lazy route or a dynamic import — let
          // Rollup keep it in an async chunk.
          return undefined;
        },
      },
    },
  },
  server: {
    // Unique, fixed port so ChatKonect never silently drifts onto another
    // project's dev server. strictPort makes a clash fail loudly instead.
    port: 5290,
    strictPort: true,
    host: true, // expose on the LAN so a friend on the same network can connect
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
