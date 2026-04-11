import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    alias: {
      '$tools': 'src/lib/tools',
      '$components': 'src/lib/components',
      '$shared': 'src/lib/shared',
      '$viewer': 'src/lib/viewer',
    },
  },
};
