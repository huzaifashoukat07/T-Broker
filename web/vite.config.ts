import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app is served by the existing Express server under /app, so the
// current vanilla site at / keeps running untouched while pages are ported
// one at a time. Build output goes straight into public/app.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: { outDir: '../public/app', emptyOutDir: true },
  server: {
    // `npm run dev` proxies the API to the running Node server
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
