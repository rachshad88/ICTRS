import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Libraries go in their own files, apart from ITRS's code. A deploy renames every file whose
// contents (or imports) changed, and browsers re-download renamed files; library files don't
// import ITRS code, so they keep their names and stay cached until the library itself updates.
// Grouped by how they update together. Unlisted packages keep Vite's default placement, so a new
// dependency is never pulled into every visitor's first download by accident.
const VENDOR_GROUPS: Record<string, string[]> = {
  'vendor-react': ['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom', '@remix-run/router'],
  'vendor-motion': ['framer-motion', 'motion-dom', 'motion-utils'],
  'vendor-data': [
    '@tanstack/query-core', '@tanstack/react-query', 'axios',
    'socket.io-client', 'socket.io-parser', 'engine.io-client', 'engine.io-parser', '@socket.io/component-emitter',
  ],
  // Only Reports imports it, so this file still loads only when Reports is opened.
  'vendor-docx': ['docx'],
};
const GROUP_OF = new Map(Object.entries(VENDOR_GROUPS).flatMap(([group, pkgs]) => pkgs.map((p) => [p, group])));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const pkg = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1];
          return pkg ? GROUP_OF.get(pkg) : undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['itrs.dave', 'getregisterforms.online'],
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  }
});
