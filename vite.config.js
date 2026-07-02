import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// TrueForm's emscripten glue spawns its pthread worker via
//   new Worker(new URL("trueform_wasm.js", import.meta.url), { type: "module" })
// Vite's `worker-import-meta-url` plugin statically matches that literal and
// tries to bundle the emscripten glue AS a worker entry — which parse-fails the
// production build. Replacing the string literal with `String("…")` keeps the
// same runtime URL while hiding it from the matcher; the "*.wasm" literal is
// left intact so Vite still emits the wasm asset. enforce:'pre' so this runs
// before worker-import-meta-url. This makes the BUILD pass — it does NOT change
// TrueForm's runtime behaviour.
//
// ⚠ RUNTIME BLOCKER (verified 2026-07-02): trueform@0.9.8 is compiled WITH
// pthreads. At tf.init() it pre-creates a worker pool sized to
// navigator.hardwareConcurrency (no InitOption to disable) and transfers the
// WASM memory (a SharedArrayBuffer) to each worker. SharedArrayBuffer transfer
// REQUIRES a cross-origin-isolated context, so tf.init() throws
//   DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated
// unless the document is served with COOP:same-origin + COEP:require-corp (or
// credentialless). Running on the main thread does NOT avoid this. Confirmed:
// adding those two headers makes the TF-tab box render (12 tris / 8 verts). To
// ship the TF tab, enable cross-origin isolation app-wide (dev: server.headers
// via a configureServer middleware — plain server.headers don't reach SvelteKit
// SSR responses; prod: set them in hooks.server.ts / adapter) — an app-wide
// decision (affects all cross-origin subresources).
function trueformWorkerFix() {
  return {
    name: 'trueform-worker-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@polydera/trueform')) return null;
      if (!code.includes('new URL("trueform_wasm.js",import.meta.url)')) return null;
      const out = code.replaceAll(
        'new URL("trueform_wasm.js",import.meta.url)',
        'new URL(String("trueform_wasm.js"),import.meta.url)',
      );
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  // Tailwind v4 Vite plugin — replaces the v3 postcss.config.cjs setup.
  // Required by the Flowbite-Svelte quickstart so `@import "tailwindcss"`
  // + `@source "..."` directives in src/app.css get processed.
  plugins: [trueformWorkerFix(), tailwindcss(), sveltekit()],
  server: {
    port: 3333,
    // Suppress the full-page error overlay. Parse / build errors still
    // appear in the dev-server console, but they don't blot out the
    // /primitives UI so the user can navigate back to the Builder tab
    // and fix the offending file. The save flow has its own client-side
    // syntax check (checkTypescriptSyntax) that catches most cases
    // before they ever hit disk; this is just the safety net.
    hmr: { overlay: false },
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
    // manifold-3d + @polydera/trueform ship emscripten WASM glue that resolves
    // its .wasm sibling via `new URL("*.wasm", import.meta.url)`. If Vite
    // pre-bundles them, import.meta.url points at .vite/deps (no sibling .wasm)
    // and the wasm 404s. Excluding them serves the raw dep from node_modules so
    // the URL resolves next to the real file. (TrueForm = the client-side TF
    // engine tab — lazy-imported only when that tab first opens.)
    exclude: ['manifold-3d', '@polydera/trueform'],
  },
  ssr: {
    // Bundle svelte/compiler into the server output (matches SVTC pattern).
    noExternal: ['svelte/compiler'],
  },
});
