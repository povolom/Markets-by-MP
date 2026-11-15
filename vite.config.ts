import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: { sourcemap: true },
  // Keep the dev server away from the desktop app's Rust build output (thousands of files).
  server: { watch: { ignored: ['**/src-tauri/**', '**/dist/**', '**/release/**'] } },
  optimizeDeps: { entries: ['index.html'] },
});
