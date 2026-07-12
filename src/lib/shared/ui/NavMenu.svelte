<script lang="ts">
  import { page } from '$app/stores';

  // Global top-right navigation menu. Mounted once in +layout.svelte so it
  // appears on every page (incl. `/`). A small fixed button (☰) opens a
  // compact dropdown of routes. Kept deliberately tiny + top-right so it
  // doesn't cover the full-screen editors' critical top-right chrome.

  let open = $state(false);

  const routes = [
    { href: '/', label: 'Home' },
    { href: '/graph-editor', label: 'Graph Editor' },
    { href: '/primitives', label: 'Primitives' },
    { href: '/vocab', label: 'Vocab' },
    { href: '/wells', label: 'Wells' },
    { href: '/volume', label: 'Volume' },
    { href: '/plan', label: 'Plan' },
    { href: '/design', label: 'Design' },
    { href: '/research', label: 'Research' }
  ];

  const current = $derived($page.url.pathname);

  function isActive(href: string): boolean {
    if (href === '/') return current === '/';
    return current === href || current.startsWith(href + '/');
  }

  function toggle() { open = !open; }
  function close() { open = false; }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  // Click-outside: a backdrop element behind the menu catches the click.
</script>

<svelte:window on:keydown={onKeydown} />

<div class="navmenu">
  <button
    class="nav-btn"
    aria-label="Navigation menu"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
  >☰</button>

  {#if open}
    <!-- transparent backdrop to catch click-outside -->
    <div class="nav-backdrop" onclick={close} role="presentation"></div>
    <nav class="nav-dropdown" role="menu">
      {#each routes as r}
        <a
          class="nav-item"
          class:active={isActive(r.href)}
          href={r.href}
          role="menuitem"
          onclick={close}
        >{r.label}</a>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .navmenu {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 100000;
    font-family: Arial, sans-serif;
  }
  .nav-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    line-height: 1;
    color: #d7dde6;
    background: rgba(28, 32, 40, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    cursor: pointer;
    backdrop-filter: blur(4px);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .nav-btn:hover { background: rgba(40, 46, 56, 0.9); color: #fff; }

  .nav-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99998;
    background: transparent;
  }

  .nav-dropdown {
    position: absolute;
    top: 36px;
    right: 0;
    z-index: 99999;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: rgba(24, 28, 36, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
  }
  .nav-item {
    display: block;
    padding: 6px 10px;
    font-size: 13px;
    color: #cfd6e0;
    text-decoration: none;
    border-radius: 5px;
    white-space: nowrap;
  }
  .nav-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .nav-item.active {
    color: #fff;
    background: rgba(80, 130, 220, 0.32);
    font-weight: 600;
  }
</style>
