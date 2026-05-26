<script lang="ts">
  /**
   * /primitives/profiles — a dedicated, full-screen PROFILE BUILDER + library.
   * Left rail: a searchable grid of every profile (curated built-ins + volume
   * function profiles), click to load. Main area: identity fields + the
   * ProfileFnEditor in `fill` mode with a large live preview. This is the
   * roomier sibling of the in-canvas ƒ popup on /primitives — same editor
   * component, same /api/primitives/profiles/{list,source,save,resolve}
   * endpoints, just more screen.
   */
  import { onMount } from 'svelte';
  import ProfileFnEditor from '$lib/shared/ProfileFnEditor.svelte';
  import ProfilePalette, { type VolProfile } from '$lib/shared/ProfilePalette.svelte';
  import { PROFILE_REGISTRY } from '$lib/shared/profile-presets';

  let set = $state<'revolve' | 'cartesian'>('revolve');
  let volume = $state<VolProfile[]>([]);
  // Parent-owned identity (the editor reads it as props for save + the slug).
  let meta = $state({ id: '', label: '', description: '', tags: '' });
  let seed = $state<any>(null);
  let current = $state<string | undefined>(undefined); // selected id (palette highlight)
  let seedKey = $state(0); // bump to REMOUNT the editor (it seeds from props once)
  let loading = $state(false);

  async function loadVolume() {
    try {
      const r = await fetch('/api/primitives/profiles/list');
      if (r.ok) { const d = await r.json(); volume = (d?.profiles ?? d ?? []) as VolProfile[]; }
    } catch { /* offline — built-ins still work */ }
  }
  onMount(loadVolume);

  // Body extraction helpers (mirror PrimitiveView): the build() body for the
  // editor seed — from a volume source.ts, or derived from a curated fn.
  function bodyOf(source: string): string {
    const i = source.indexOf('{'), j = source.lastIndexOf('}');
    return i >= 0 && j > i ? source.slice(i + 1, j).replace(/^\n/, '').replace(/\n\s*$/, '') : source;
  }
  function curatedBody(build: (p: any) => any): string {
    try {
      const s = build.toString();
      const a = s.indexOf('=>');
      if (a < 0) return '';
      const after = s.slice(a + 2).trim();
      if (after.startsWith('{')) return after.slice(1, after.lastIndexOf('}')).trim();
      return 'return ' + after.replace(/;\s*$/, '') + ';';
    } catch { return ''; }
  }

  function newProfile() {
    meta = { id: '', label: '', description: '', tags: '' };
    seed = null;
    current = undefined;
    seedKey++;
  }
  function switchSet(s: 'revolve' | 'cartesian') {
    if (s === set) return;
    set = s;
    newProfile();
  }

  async function loadProfile(id: string, origin: 'builtin' | 'volume') {
    if (origin === 'builtin') {
      const def = PROFILE_REGISTRY[id];
      if (!def) return;
      set = def.set;
      meta = { id: def.id, label: def.label, description: '', tags: def.tags.join(', ') };
      seed = { id: def.id, label: def.label, tags: def.tags, params: def.params, body: curatedBody(def.build) };
      current = id; seedKey++;
      return;
    }
    loading = true;
    try {
      const r = await fetch(`/api/primitives/profiles/source?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const p = await r.json();
      set = p.set ?? 'revolve';
      meta = {
        id: p.id, label: p.label ?? p.id, description: p.description ?? '',
        tags: Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags ?? ''),
      };
      seed = { id: p.id, label: p.label, description: p.description, tags: p.tags, params: p.params, body: p.source ? bodyOf(p.source) : '' };
      current = id; seedKey++;
    } finally { loading = false; }
  }

  // On save: refresh the list + keep editing the saved profile (so further
  // saves UPDATE it and the palette highlights it).
  async function onSaved(id: string) {
    await loadVolume();
    await loadProfile(id, 'volume');
  }
</script>

<svelte:head><title>Profiles — CAD Train</title></svelte:head>

<div class="prof-page">
  <header class="prof-top">
    <a class="prof-back" href="/primitives" title="Back to primitives">‹ Primitives</a>
    <h1>Profiles</h1>
    <div class="prof-seg" role="group" aria-label="Profile set">
      <button type="button" class:on={set === 'revolve'} onclick={() => switchSet('revolve')}>Revolve</button>
      <button type="button" class:on={set === 'cartesian'} onclick={() => switchSet('cartesian')}>Cartesian</button>
    </div>
    <span class="prof-count">{volume.filter((v) => v.set === set).length} custom · {Object.values(PROFILE_REGISTRY).filter((d) => d.set === set).length} built-in</span>
    <button type="button" class="prof-new" onclick={newProfile}>+ New profile</button>
  </header>

  <div class="prof-body">
    <aside class="prof-rail">
      <ProfilePalette fill {set} {volume} {current} layout="grid"
        onPick={(id, origin) => loadProfile(id, origin)}
        onEdit={(id) => loadProfile(id, 'volume')} />
    </aside>

    <main class="prof-main">
      <div class="prof-identity">
        <label class="pi-field pi-id"><span>id</span>
          <input bind:value={meta.id} placeholder="profile_id" spellcheck="false" /></label>
        <label class="pi-field pi-name"><span>name</span>
          <input bind:value={meta.label} placeholder="Display name" /></label>
        <label class="pi-field pi-tags"><span>tags</span>
          <input bind:value={meta.tags} placeholder="comma, separated" spellcheck="false" /></label>
        <label class="pi-field pi-desc"><span>description</span>
          <input bind:value={meta.description} placeholder="optional" /></label>
      </div>

      <div class="prof-editor">
        {#key seedKey}
          <ProfileFnEditor fill {set} {seed}
            id={meta.id} label={meta.label} description={meta.description} tags={meta.tags}
            onSaved={onSaved} onClose={newProfile} />
        {/key}
      </div>
    </main>
  </div>
</div>

<style>
  .prof-page { display: flex; flex-direction: column; height: 100%; min-height: 0; font: 13px Arial; color: #222; }
  /* header */
  .prof-top { display: flex; align-items: center; gap: 16px; padding: 8px 16px; border-bottom: 1px solid #e6e6ec; background: #fafafa; flex: 0 0 auto; }
  .prof-back { color: #c4392f; text-decoration: none; font: 600 12px Arial; }
  .prof-back:hover { text-decoration: underline; }
  .prof-top h1 { font: 700 15px Arial; margin: 0; letter-spacing: .01em; }
  .prof-seg { display: inline-flex; border: 1px solid #e0cfcb; border-radius: 6px; overflow: hidden; }
  .prof-seg button { border: 0; background: #fff; color: #8a6f6b; font: 600 11px Arial; padding: 4px 12px; cursor: pointer; }
  .prof-seg button:hover { background: #fceeec; }
  .prof-seg button.on { background: #c4392f; color: #fff; }
  .prof-count { font: 11px Arial; color: #999; }
  .prof-new { margin-left: auto; border: 1px solid #a8302a; background: #c4392f; color: #fff; border-radius: 6px; padding: 5px 14px; font: 600 12px Arial; cursor: pointer; }
  .prof-new:hover { background: #b23329; }
  /* body: rail + main */
  .prof-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 240px 1fr; }
  .prof-rail { border-right: 1px solid #e6e6ec; background: #fcfcfd; padding: 10px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .prof-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 14px 16px; gap: 12px; }
  /* identity row */
  .prof-identity { display: grid; grid-template-columns: 0.8fr 1.1fr 1.1fr 1.6fr; gap: 10px; flex: 0 0 auto; }
  .pi-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .pi-field span { font: 700 8px Arial; text-transform: uppercase; letter-spacing: .06em; color: #9a9aa8; }
  .pi-field input { font: 12px Arial; padding: 5px 8px; border: 1px solid #dcdce4; border-radius: 5px; width: 100%; box-sizing: border-box; }
  .pi-field.pi-id input { font-family: 'SF Mono', Menlo, monospace; }
  .pi-field input:focus { outline: none; border-color: #c4392f; }
  /* editor host — the fill-mode ProfileFnEditor occupies all remaining space */
  .prof-editor { flex: 1 1 auto; min-height: 0; }
</style>
