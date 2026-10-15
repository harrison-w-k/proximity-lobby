import { defineConfig } from 'vite';

// Client lives in ./client; production build is served by the Node server from dist/client.
export default defineConfig({
  root: 'client',
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});
