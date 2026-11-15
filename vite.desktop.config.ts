// Builds the web app for the desktop app (Tauri), with the Markets API embedded so it runs inside the
// app's own window. The Cloudflare build (vite.config.ts) leaves the embedded API out entirely.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), { name: 'desktop-entry', transformIndexHtml: { order: 'pre', handler: (html: string) => html.replace('/src/web/main.tsx', '/src/desktop/main.tsx').replace(/<link rel="manifest"[^>]*>/, '') } }],
  define: { 'import.meta.env.VITE_DESKTOP': 'true' },
  build: { outDir: 'dist/desktop', emptyOutDir: true, target: ['safari16', 'edge110'], chunkSizeWarningLimit: 3000 },
  server: { port: 5174, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/dist/**'] } },
  optimizeDeps: { entries: ['index.html'] },
  clearScreen: false,
});
