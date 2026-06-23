import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Tailwind v4 Vite plugin — replaces the v3 postcss.config.cjs setup.
  // Required by the Flowbite-Svelte quickstart so `@import "tailwindcss"`
  // + `@source "..."` directives in src/app.css get processed.
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 3333,
    // Suppress the full-page error overlay. Parse / build errors still
    // appear in the dev-server console, but they don't blot out the
    // /primitives UI so the user can navigate back to the Builder tab
    // and fix the offending file. The save flow has its own client-side
    // syntax check (checkTypescriptSyntax) that catches most cases
    // before they ever hit disk; this is just the safety net.
    hmr: { overlay: false },
    fs: { allow: ['/Users/neerajsethi/code/cadtrain/node_modules'] },
    // Exclude runtime-written data from Vite's file watcher so saving an
    // authored part / training cache record / eval result doesn't trigger
    // a full dev server restart. The symlink `static/training_data ->
    // ../training_data` exposes these paths to the watcher by default.
    //
    // When persistence migrates to the Railway volume (`/data`), the
    // ignored set should be updated to point at the volume mount root
    // and dropped here for paths that are no longer written by the app
    // at runtime. See task #18.
    watch: {
      ignored: [
        '**/training_data/**',
        '**/static/training_data/**',
        '**/static/eval/**',
        '**/static/tests/**',
        '**/static/tmp/**',
        '**/static/kb/**',
        // The Railway volume in prod — harmless in dev; future-proofs the
        // config so prod-style writes (when wired) don't fight the watcher
        // on machines that mount /data locally for testing.
        '/data/**',
      ],
    },
  },
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  ssr: {
    // Bundle svelte/compiler into the server output (matches SVTC pattern).
    noExternal: ['svelte/compiler'],
  },
});
