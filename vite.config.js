import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
