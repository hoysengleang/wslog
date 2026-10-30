import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const server = process.env.WSLOG_DEV_SERVER ?? 'http://127.0.0.1:4000';

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': { target: server, ws: true },
    },
  },
});
