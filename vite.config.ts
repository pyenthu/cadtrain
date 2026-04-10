import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'viewer',
  plugins: [svelte()],
  server: { port: 3333 },
  publicDir: '../',
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
});
