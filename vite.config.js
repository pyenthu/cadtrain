import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 3333 },
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  ssr: {
    // Bundle svelte/compiler into the server output (matches SVTC pattern).
    noExternal: ['svelte/compiler'],
  },
});
