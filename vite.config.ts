import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so production builds need that base path.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/stranded-corps/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
}));
