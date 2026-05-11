<!--
  /library was the standalone grid view. The unified workbench (library +
  scene + metadata/parts in one window) now lives at /author. This page is
  a thin redirect that preserves any ?id= query string so deep-links keep
  working.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  onMount(() => {
    const search = window.location.search ?? '';
    window.location.replace(`/author${search}`);
  });
</script>

<div class="redirecting">
  <p>Redirecting to <a href="/author">/author</a>…</p>
</div>

<style>
  .redirecting { padding: 40px; text-align: center; font: 13px Arial; color: #888; }
  .redirecting a { color: #cc2222; }
</style>
