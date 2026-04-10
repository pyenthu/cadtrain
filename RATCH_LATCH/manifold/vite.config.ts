import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'threlte',
  plugins: [svelte()],
  server: { port: 3335 },
  publicDir: '../',
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
});
