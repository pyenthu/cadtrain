<script lang="ts">
  import '../app.css'; // Tailwind directives — kept so flowbite-svelte
  // components (used by /vocab + future pages) still pick up their classes.
  import NavMenu from '$lib/shared/NavMenu.svelte';
  let { children } = $props();

  // Top Flowbite Navbar REMOVED (2026-06-09 — redundant with the
  // /primitives tab strip + per-page chrome). Navigation between pages
  // now relies on direct URL entry; page-local chrome (the /primitives
  // sidebar, the graph editor's rail) handles in-page navigation.
</script>

<div class="layout">
  <NavMenu />
  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  :global(html, body) { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; font-family: Arial, sans-serif; }
  /* SvelteKit's `<div id="app">` wrapper in app.html — without this, it
     stays at `display: block; height: auto` and sizes to its content,
     which is shorter than the viewport when the rail's primitive list
     gets short. That made `.layout`'s `height: 100%` resolve to the
     #app box height (~455 px) instead of the body's 598 px, and the
     canvas + sidebar both shrank to fit the rail. Pinning #app to
     100% propagates the viewport height all the way down. */
  :global(#app) { height: 100%; min-height: 0; display: flex; flex-direction: column; }
  /* No header row — content fills the entire viewport. min-height: 0
     keeps any nested grid 1fr rows clamped to the actual viewport
     instead of sizing to max-content of the canvas. `height: 100%`
     (not `100vh`) so we inherit from html/body's 100% — browser
     extensions and PWA chromes can shrink the visible inner height
     below `100vh` (which still measures the unobstructed viewport),
     and that gap was making the layout 57 px taller than visible,
     scrolling the whole page instead of the rail. */
  .layout { display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; min-height: 0; flex: 1 1 auto; }
  .content { overflow: hidden; min-width: 0; min-height: 0; }
</style>
