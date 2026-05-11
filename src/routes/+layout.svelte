<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();

  const navLinks = [
    { href: '/library', label: 'Library' },
    { href: '/author', label: 'Author' },
    { href: '/kb', label: 'KB' },
    { href: '/wells', label: 'Wells' },
    { href: '/archive/tests', label: 'Tests' },
    { href: '/plan', label: 'Plan' },
    { href: '/archive', label: 'Archive' },
  ];

  // Longest-matching prefix wins so '/archive/tests' highlights Tests (not Archive).
  let activeHref = $derived.by(() => {
    const path = page.url.pathname;
    return navLinks
      .filter((l) => path === l.href || path.startsWith(l.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  });
</script>

<div class="layout">
  <nav class="navbar">
    <a href="/" class="brand" class:active={page.url.pathname === '/'}>CAD Train</a>
    {#each navLinks as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={activeHref === item.href}
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
  .navbar { display: flex; align-items: center; gap: 2px; padding: 0 12px; background: #222; height: 36px; flex-shrink: 0; }
  .brand { font: bold 14px Arial; color: #cc2222; margin-right: 24px; text-decoration: none; padding: 6px 4px; border-radius: 4px; }
  .brand.active { color: #fff; }
  .brand:hover { color: #fff; }
  .nav-item { font: 13px Arial; color: #aaa; text-decoration: none; padding: 6px 14px; border-radius: 4px; }
  .nav-item:hover { color: #fff; background: #333; }
  .nav-item.active { color: #fff; background: #cc2222; }
  .content { flex: 1; overflow: hidden; }
</style>
