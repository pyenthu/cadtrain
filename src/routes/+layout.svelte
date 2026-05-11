<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();

  // SVTC-style nav: compact grid-icon button in the top-right corner; click
  // reveals a dropdown menu. No always-on rail — content gets the whole
  // viewport. Sections inside the dropdown stay the same (Author /
  // Library / Wells / Meta) so the IA didn't move, only the chrome.
  const navSections = [
    {
      label: null,
      items: [
        { href: '/primitives', label: 'Primitives' },
      ],
    },
    {
      label: 'Wells',
      items: [
        { href: '/wells', label: 'Wells' },
      ],
    },
    {
      label: 'Meta',
      items: [
        { href: '/archive/tests', label: 'Tests' },
        { href: '/plan',          label: 'Plan' },
        { href: '/archive',       label: 'Archive' },
      ],
    },
  ];
  const allNavLinks = navSections.flatMap((s) => s.items);

  let activeHref = $derived.by(() => {
    const path = page.url.pathname;
    return allNavLinks
      .filter((l) => path === l.href || path.startsWith(l.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  });

  let open = $state(false);

  // Click-outside to close. Wraps the button + the dropdown in
  // #nav-menu-wrapper so any click inside it doesn't dismiss.
  function onWindowClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest('#nav-menu-wrapper')) open = false;
  }
  function navClicked() { open = false; }
</script>

<svelte:window onclick={onWindowClick} />

<div class="layout">
  <main class="content">
    {@render children()}
  </main>

  <div id="nav-menu-wrapper">
    <button
      class="nav-btn"
      class:open
      type="button"
      aria-label="Open navigation menu"
      aria-expanded={open}
      onclick={(e) => { e.stopPropagation(); open = !open; }}
    >
      <!-- 2×2 grid glyph, mirrors SVTC's GridOutline. Inline SVG keeps the
           component self-contained, no icon-library dependency. -->
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6" rx="1.4" fill="currentColor" />
        <rect x="9" y="1" width="6" height="6" rx="1.4" fill="currentColor" />
        <rect x="1" y="9" width="6" height="6" rx="1.4" fill="currentColor" />
        <rect x="9" y="9" width="6" height="6" rx="1.4" fill="currentColor" />
      </svg>
    </button>

    {#if open}
      <nav class="navmenu">
        <a href="/" class="brand" onclick={navClicked}>CAD Train</a>
        {#each navSections as sec, i (i)}
          {#if sec.label}<div class="section-label">{sec.label}</div>{/if}
          {#each sec.items as item (item.href)}
            <a
              href={item.href}
              class="nav-item"
              class:active={activeHref === item.href}
              onclick={navClicked}
            >{item.label}</a>
          {/each}
          {#if i < navSections.length - 1}<hr class="div" />{/if}
        {/each}
      </nav>
    {/if}
  </div>
</div>

<style>
  :global(html, body) { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; font-family: Arial, sans-serif; }
  .layout { display: flex; flex-direction: column; height: 100vh; }
  .content { flex: 1; overflow: hidden; min-width: 0; }

  /* Fixed corner button + dropdown wrapper. z-index sits above everything
     so the menu floats over any page content (e.g. /author's 3D canvas). */
  #nav-menu-wrapper {
    position: fixed; top: 10px; right: 12px; z-index: 100;
  }
  .nav-btn {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    background: #cc2222; color: #fff;
    border: none; border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: background 80ms;
  }
  .nav-btn:hover { background: #a91d1d; }
  .nav-btn.open { background: #a91d1d; }

  .navmenu {
    position: absolute; top: 38px; right: 0;
    min-width: 180px;
    background: #fff;
    border: 1px solid #cc2222;
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
    overflow: hidden;
  }
  .brand {
    display: block;
    font: bold 11px Arial; color: #cc2222;
    text-transform: uppercase; letter-spacing: 0.6px;
    padding: 8px 14px 8px;
    background: #fef0f0;
    border-bottom: 1px solid #f5d5d5;
    text-decoration: none;
  }
  .brand:hover { background: #fbe0e0; }
  .section-label {
    font: bold 9px Arial; color: #cc2222;
    text-transform: uppercase; letter-spacing: 1px;
    padding: 8px 14px 2px;
  }
  .nav-item {
    display: block;
    font: 13px Arial; color: #333;
    text-decoration: none;
    padding: 5px 14px;
  }
  .nav-item:hover { background: #fef0f0; color: #cc2222; }
  .nav-item.active { background: #cc2222; color: #fff; }
  .div { border: none; border-top: 1px solid #ececec; margin: 4px 0; }
</style>
