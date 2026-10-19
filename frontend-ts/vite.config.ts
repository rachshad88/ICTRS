import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import type { OutputBundle, OutputChunk, Plugin } from 'vite';

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

// Public pages that are their own files (routes.ts PUBLIC_PAGES), by URL.
const PAGE_FILES: Record<string, string> = {
  '/login': 'src/pages/Login.tsx',
  '/signup': 'src/pages/Signup.tsx',
  '/guide': 'src/pages/ClientGuide.tsx',
};

/**
 * A visit straight to /signup (or /login, /guide) would otherwise wait for the main script to run
 * before even asking for the page's own file. This puts a tiny script in index.html that preloads
 * the current page's file and the shared files it imports, so they download alongside the main
 * script and the page can draw as soon as it runs.
 */
function preloadCurrentPage(): Plugin {
  return {
    name: 'preload-current-page',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle as OutputBundle | undefined;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk');
        const entry = chunks.find((c) => c.isEntry);
        // Files index.html already loads: the entry and everything it imports up front.
        const loaded = new Set(entry ? [entry.fileName, ...entry.imports] : []);
        const map: Record<string, string[]> = {};
        for (const [url, src] of Object.entries(PAGE_FILES)) {
          const chunk = chunks.find((c) => c.facadeModuleId?.endsWith(src));
          if (!chunk) continue;
          map[url] = [chunk.fileName, ...chunk.imports].filter((f) => !loaded.has(f)).map((f) => '/' + f);
        }
        const script =
          `<script>(function(m){var f=m[location.pathname];if(!f)return;f.forEach(function(h){` +
          `var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=h;document.head.appendChild(l)})})(` +
          `${JSON.stringify(map)})</script>`;
        return html.replace('</head>', `    ${script}\n  </head>`);
      },
    },
  };
}

/**
 * Content Security Policy for the built app, as a <meta> at the top of index.html. Scripts run only
 * from ITRS's own files and the inline scripts in index.html, each allowed by its hash; the hashes
 * are worked out here at build time, because the preload script above changes with every build.
 * Styles allow inline ones: the animations set style attributes as they run. Uploaded images and
 * attachments previewed before upload are blob: URLs; the CSS draws arrows and masks as data: URLs.
 * A meta policy can't say who may frame the page; nginx sends that part (deploy/nginx-itrs-headers.conf).
 * Runs last, after every other plugin has finished changing index.html.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
        const hashes = inline.map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          "connect-src 'self'",
          "media-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadCurrentPage(), contentSecurityPolicy()],
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
