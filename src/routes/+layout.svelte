<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();

  const segments = [
    {
      label: 'Training',
      items: [
        { href: '/components', label: 'Components' },
        { href: '/reverse', label: 'Reverse' },
        { href: '/training', label: 'Training' },
        { href: '/tests', label: 'Tests' },
      ],
    },
    {
      label: 'Build',
      items: [
        { href: '/author', label: 'Author' },
        { href: '/library', label: 'Library' },
      ],
    },
    {
      label: 'Tools',
      items: [
        { href: '/tools/bottom-sub', label: 'Bottom Sub' },
        { href: '/tools/ratch-latch', label: 'Ratch-Latch' },
      ],
    },
  ];
</script>

<div class="layout">
  <nav class="navbar">
    <a href="/" class="brand" class:active={page.url.pathname === '/'}>CAD Train</a>
    {#each segments as seg, i}
      {#if i > 0}<span class="sep"></span>{/if}
      <span class="seg-label">{seg.label}</span>
      {#each seg.items as item}
        <a
          href={item.href}
          class="nav-item"
          class:active={page.url.pathname === item.href}
        >
          {item.label}
        </a>
      {/each}
    {/each}
  </nav>
  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  :global(html, body) { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; font-family: Arial, sans-serif; }
  .layout { display: flex; flex-direction: column; height: 100vh; }
  .navbar { display: flex; align-items: center; gap: 4px; padding: 0 12px; background: #222; height: 36px; flex-shrink: 0; }
  .brand { font: bold 14px Arial; color: #cc2222; margin-right: 16px; text-decoration: none; padding: 6px 4px; border-radius: 4px; }
  .brand.active { color: #fff; }
  .brand:hover { color: #fff; }
  .seg-label { font: bold 10px Arial; color: #666; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 4px 0 0; }
  .sep { width: 1px; height: 16px; background: #444; margin: 0 8px; }
  .nav-item { font: 12px Arial; color: #aaa; text-decoration: none; padding: 6px 12px; border-radius: 4px; }
  .nav-item:hover { color: #fff; background: #333; }
  .nav-item.active { color: #fff; background: #cc2222; }
  .content { flex: 1; overflow: hidden; }
</style>
