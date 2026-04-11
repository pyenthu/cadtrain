<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();

  const nav = [
    { href: '/', label: 'Home' },
    { href: '/components', label: 'Components' },
    { href: '/training', label: 'Training' },
    { href: '/tools/bottom-sub', label: 'Bottom Sub' },
    { href: '/tools/ratch-latch', label: 'Ratch-Latch' },
  ];
</script>

<div class="layout">
  <nav class="navbar">
    <span class="brand">CAD Train</span>
    {#each nav as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={page.url.pathname === item.href}
      >
        {item.label}
      </a>
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
  .brand { font: bold 14px Arial; color: #cc2222; margin-right: 16px; }
  .nav-item { font: 12px Arial; color: #aaa; text-decoration: none; padding: 6px 12px; border-radius: 4px; }
  .nav-item:hover { color: #fff; background: #333; }
  .nav-item.active { color: #fff; background: #cc2222; }
  .content { flex: 1; overflow: hidden; }
</style>
