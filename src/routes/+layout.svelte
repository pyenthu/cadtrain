<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();

  // Right-rail nav grouped into sections. COMPONENTS is the design workflow
  // (browse what shapes exist → see family archetypes → build → reference
  // data). WELLS is its own vertical. Plan / Tests / Archive sit unlabeled
  // at the bottom as "everything else". `label: null` suppresses the
  // section header so the unlabeled group still groups visually (spacing
  // + divider) without an "OTHER" label.
  const navSections = [
    {
      label: 'Components',
      items: [
        { href: '/primitives', label: 'Primitives' },
        { href: '/families',   label: 'Families' },
        { href: '/author',     label: 'Author' },
        { href: '/kb',         label: 'KB' },
      ],
    },
    {
      label: 'Wells',
      items: [
        { href: '/wells', label: 'Wells' },
      ],
    },
    {
      label: null,
      items: [
        { href: '/archive/tests', label: 'Tests' },
        { href: '/plan',          label: 'Plan' },
        { href: '/archive',       label: 'Archive' },
      ],
    },
  ];
  const allNavLinks = navSections.flatMap((s) => s.items);

  // Longest-matching prefix wins so '/archive/tests' highlights Tests (not Archive).
  let activeHref = $derived.by(() => {
    const path = page.url.pathname;
    return allNavLinks
      .filter((l) => path === l.href || path.startsWith(l.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  });
</script>

<div class="layout">
  <!-- Main content fills the viewport; the navmenu lives on the right as a
       vertical column. Replaces the prior top-row navbar — the new shape
       reads more like a workbench (content forward, nav out of the way). -->
  <main class="content">
    {@render children()}
  </main>
  <nav class="navbar">
    <a href="/" class="brand" class:active={page.url.pathname === '/'}>CAD Train</a>
    {#each navSections as sec, secIdx (secIdx)}
      <div class="nav-section" class:no-label={!sec.label}>
        {#if sec.label}<div class="section-label">{sec.label}</div>{/if}
        {#each sec.items as item (item.href)}
          <a
            href={item.href}
            class="nav-item"
            class:active={activeHref === item.href}
          >{item.label}</a>
        {/each}
      </div>
    {/each}
  </nav>
</div>

<style>
  :global(html, body) { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; font-family: Arial, sans-serif; }
  .layout { display: flex; flex-direction: row; height: 100vh; }
  .content { flex: 1; overflow: hidden; min-width: 0; }
  .navbar {
    width: 140px; flex-shrink: 0;
    display: flex; flex-direction: column; gap: 2px;
    padding: 14px 10px;
    background: #222;
    overflow-y: auto;
  }
  .brand {
    font: bold 14px Arial; color: #cc2222;
    text-decoration: none;
    padding: 6px 10px; border-radius: 4px;
    margin-bottom: 14px;
    letter-spacing: 0.5px;
  }
  .brand.active { color: #fff; }
  .brand:hover { color: #fff; }
  .nav-section { display: flex; flex-direction: column; gap: 1px; margin-bottom: 10px; }
  .section-label {
    font: bold 9px Arial; color: #777;
    letter-spacing: 1px; text-transform: uppercase;
    padding: 6px 10px 4px;
    border-top: 1px solid #333;
  }
  .nav-section:first-of-type .section-label { border-top: none; padding-top: 0; }
  .nav-section.no-label { border-top: 1px solid #333; padding-top: 4px; }
  .nav-item {
    font: 13px Arial; color: #aaa;
    text-decoration: none;
    padding: 6px 12px; border-radius: 4px;
  }
  .nav-item:hover { color: #fff; background: #333; }
  .nav-item.active { color: #fff; background: #cc2222; }

  /* Below 600px collapse the nav to the bottom so the main content keeps
     real estate. Becomes a horizontal strip; same DOM, just re-flowed.
     Section labels are hidden because there isn't horizontal room for
     them — items still group by section visually via the dividers. */
  @media (max-width: 600px) {
    .layout { flex-direction: column; }
    .navbar {
      width: 100%; height: auto; flex-direction: row; flex-wrap: wrap;
      padding: 8px 10px; gap: 4px;
      border-top: 1px solid #333;
    }
    .brand { margin-bottom: 0; margin-right: 12px; }
    .nav-section { flex-direction: row; gap: 2px; margin-bottom: 0; flex-wrap: wrap; }
    .section-label { display: none; }
    .nav-section.no-label { border-top: none; padding-top: 0; }
    .nav-section + .nav-section { padding-left: 6px; border-left: 1px solid #333; margin-left: 4px; }
    .nav-item { padding: 6px 10px; font-size: 12px; }
  }
</style>
