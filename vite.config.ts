import { defineConfig } from 'vite';

// GitHub Pages serves the site under /<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
