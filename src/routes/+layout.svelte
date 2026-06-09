<script lang="ts">
  import '../app.css'; // Tailwind directives — kept so flowbite-svelte
  // components (used by /vocab + future pages) still pick up their classes.
  let { children } = $props();

  // Top Flowbite Navbar REMOVED (2026-06-09 — redundant with the
  // /primitives tab strip + per-page chrome). Navigation between pages
  // now relies on direct URL entry; page-local chrome (the /primitives
  // sidebar, the graph editor's rail) handles in-page navigation.
</script>

<div class="layout">
  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  :global(html, body) { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; font-family: Arial, sans-serif; }
  /* No header row — content fills the entire viewport. min-height: 0
     keeps any nested grid 1fr rows clamped to the actual viewport
     instead of sizing to max-content of the canvas. `height: 100%`
     (not `100vh`) so we inherit from html/body's 100% — browser
     extensions and PWA chromes can shrink the visible inner height
     below `100vh` (which still measures the unobstructed viewport),
     and that gap was making the layout 57 px taller than visible,
     scrolling the whole page instead of the rail. */
  .layout { display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; min-height: 0; }
  .content { overflow: hidden; min-width: 0; min-height: 0; }
</style>
