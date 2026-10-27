import { defineConfig } from 'vite';

// GitHub Pages serves the site under /<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  // the simulation runs in module Workers (src/ui/simWorker.ts)
  worker: { format: 'es' },
});
