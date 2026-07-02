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
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'charts';
          if (id.includes('framer-motion')) return 'motion';
          return 'vendor';
        },
      },
    },
  },
  server: {
    // Unique, fixed port so ChatConnect never silently drifts onto another
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
