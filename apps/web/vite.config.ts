import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API and the socket live on the server process; proxying keeps the browser
    // on one origin so session cookies work without CORS.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    // 'hidden' keeps the maps for a debugging operator without advertising them in
    // every served bundle.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          // React changes on a different cadence from the app; a separate chunk means
          // an app deploy doesn't re-download the framework.
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
