<script lang="ts">
  import { page } from '$app/state';
  import '../app.css'; // Tailwind directives — needed for flowbite-svelte components
  import { Navbar, NavBrand, NavLi, NavUl, NavHamburger } from 'flowbite-svelte';
  let { children } = $props();

  // Flowbite-svelte Navbar (2026-06-09 — task #120). Replaces the
  // previous SVTC-style corner-button dropdown. Tailwind preflight is
  // disabled in tailwind.config.cjs so cadtrain's hand-rolled CSS keeps
  // working; Flowbite components style themselves via their own
  // utility classes.
  const navLinks = [
    { href: '/graph-editor', label: 'Primitives' },
    { href: '/vocab',        label: 'Vocab' },
    { href: '/wells',        label: 'Wells' },
    { href: '/fem',          label: 'FEM' },
    { href: '/forge',        label: 'Forge' },
    { href: '/volume',       label: 'Volume' },
    { href: '/plan',         label: 'Plan' },
  ];
  let activeUrl = $derived(page.url.pathname);
</script>

<div class="layout">
  <Navbar fluid class="layout-nav border-b border-gray-200 dark:border-gray-700">
    <NavBrand href="/">
      <span class="self-center text-lg font-semibold text-red-700 whitespace-nowrap">CAD Train</span>
    </NavBrand>
    <NavHamburger />
    <NavUl {activeUrl}>
      {#each navLinks as l (l.href)}
        <NavLi href={l.href}>{l.label}</NavLi>
      {/each}
    </NavUl>
  </Navbar>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  :global(html, body) { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; font-family: Arial, sans-serif; }
  /* CSS grid 1fr defaults to `minmax(auto, 1fr)` — the `auto` minimum lets
     content force the row taller than the grid container. Without
     `min-height: 0` here, the 1fr row sizes to the canvas's max-content
     (which is whatever fills the viewport) and the layout balloons to
     ~2× the actual browser height. Setting the layout `min-height: 0`
     AND the content row both clamps the grid back to viewport. */
  .layout { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; min-height: 0; }
  /* Flowbite Navbar inherits Tailwind padding (px-4 sm:px-6); trim it a
     touch so cadtrain pages get every pixel of canvas they can. */
  :global(.layout-nav) { padding-top: 6px; padding-bottom: 6px; min-height: 0; }
  .content { overflow: hidden; min-width: 0; min-height: 0; }
</style>
