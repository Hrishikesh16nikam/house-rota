import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // During development the API runs separately (npm run local, or wrangler dev).
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
