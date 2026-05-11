<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { initManifold } from '$lib/components/builder';
  import { COMPONENTS } from '$lib/components/library';
  import { buildAuthored } from '$lib/authoring/compose';
  import { emptyAuthoredComponent, type AuthoredComponent, type AuthoredPart, type AuthoredOp, type AuthoringStep, type CsgOpKind } from '$lib/authoring/schema';
  import { setSpec } from '$lib/authoring/tools';
  import { onMount } from 'svelte';

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  let ready = $state(false);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let buildError = $state<string | null>(null);
  let showCutaway = $state(true);
  let showEdges = $state(true);

  let spec = $state<AuthoredComponent>(emptyAuthoredComponent());
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveNotice = $state<string | null>(null);

  // Panel collapse — let the user fold left (library) and right (metadata +
  // parts/ops) panels away so the 3D viewport gets full width (essential
  // on mobile, useful on desktop). Persisted to localStorage. Default closed
  // on phones, open on desktop.
  let showLibrary = $state(true);
  let showEdit = $state(true);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const isPhone = window.matchMedia('(max-width: 600px)').matches;
    showLibrary = localStorage.getItem('author:showLibrary') === '1' || (!isPhone && localStorage.getItem('author:showLibrary') !== '0');
    showEdit = localStorage.getItem('author:showEdit') === '1' || (!isPhone && localStorage.getItem('author:showEdit') !== '0');
  });
  function toggleLibrary() { showLibrary = !showLibrary; localStorage.setItem('author:showLibrary', showLibrary ? '1' : '0'); }
  function toggleEdit() { showEdit = !showEdit; localStorage.setItem('author:showEdit', showEdit ? '1' : '0'); }

  // Right panel is a single "Components" view — pipe-taxonomy methodology
  // surface on top, parts/ops editor in the middle, metadata at the bottom.
  // Used to be three separate tabs (Parameters / Metadata / Library) but
  // they're closely related when designing a pipe component, so they live
  // together in one scrollable column now.

  // Library list — sourced from /api/author/list. Click a card → loads
  // that spec into the workbench (replaces the old separate /library page).
  interface IndexEntry {
    id: string;
    name: string;
    description: string;
    tags: string[];
    source: 'manual' | 'claude_suggested' | 'claude_refined';
    parts_count: number;
    has_thumbnail: boolean;
  }
  let libRecords = $state<IndexEntry[]>([]);
  let libLoading = $state(true);
  let libError = $state<string | null>(null);

  async function loadLibrary() {
    libLoading = true; libError = null;
    try {
      const r = await fetch('/api/author/list', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      libRecords = data.records ?? [];
    } catch (e: any) {
      libError = e?.message ?? String(e);
    } finally {
      libLoading = false;
    }
  }

  async function selectLibraryItem(id: string) {
    // Update URL so reload/share works, then fetch + swap the spec.
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    window.history.replaceState({}, '', url);
    try {
      const r = await fetch(`/api/author/list?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const rec = await r.json();
      if (rec) spec = rec as AuthoredComponent;
    } catch (e: any) {
      saveError = `load failed: ${e?.message ?? e}`;
    }
  }

  let ChatPanel = $state<any>(null);

  function logStep(actor: AuthoringStep['actor'], action: AuthoringStep['action'], payload: unknown) {
    if (!spec.authoring_log) spec.authoring_log = [];
    spec.authoring_log.push({ t: new Date().toISOString(), actor, action, payload });
  }

  let SceneComponent = $state<any>(null);
  // Top-left overlay panel with editable camera + light position/intensity
  // boxes. Mounted as a normal HTML overlay (NOT via threlte's <HTML>) so it
  // anchors to the viewport's top-left, not the projected 3D origin.
  let SceneControls = $state<any>(null);

  // Pipe-family / archetype browsing now lives at /families. /author is a
  // pure editor — parts/ops + metadata. ?prim=<id> or ?family=<id> query
  // params seed a new component for fast browse → build flow.
  import { pipeJointTemplate } from '$lib/components/pipe/design_space';

  // One-time mount work in onMount, NOT $effect. Was previously inside an
  // $effect that read `spec` (via setSpec(spec, ...)) AND wrote `spec = rec`
  // after the URL-id fetch resolved → effect re-ran on every spec write →
  // re-fetched → infinite loop (293k requests in 8 seconds blanked the page).
  // onMount runs once after mount; spec writes can't retrigger it.
  onMount(() => {
    import('$lib/shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
    import('$lib/shared/SceneControls.svelte').then(m => { SceneControls = m.default; });
    import('$lib/authoring/ChatPanel.svelte').then(m => { ChatPanel = m.default; });
    initManifold().then(() => { ready = true; });

    // Bind the tool dispatcher to our live spec so Claude's tool calls
    // mutate the spec directly. The onChange callback forces Svelte to
    // notice mutations by re-assigning spec.parts/ops.
    setSpec(spec, () => {
      spec.parts = [...spec.parts];
      spec.ops = [...spec.ops];
    });

    // Load the library list for the left panel.
    loadLibrary();

    // Query-param-driven loading. Priority: ?id wins (load existing
    // authored component) > ?family (seed 3-part pipeJointTemplate) >
    // ?prim (seed a new component with one part of that primitive).
    const url = new URL(window.location.href);
    const id = url.searchParams.get('id');
    const family = url.searchParams.get('family');
    const prim = url.searchParams.get('prim');

    if (id) {
      fetch(`/api/author/list?id=${encodeURIComponent(id)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((rec) => { if (rec) spec = rec as AuthoredComponent; })
        .catch((e) => { saveError = `load failed: ${e?.message ?? e}`; });
    } else if (family) {
      // ?family=<id> from /families → seed a pipe-joint template (body +
      // top box + bot pin of that family) so the user lands in /author
      // with a 3-part assembly already in place.
      try {
        const tmpl = pipeJointTemplate(family);
        spec = {
          ...emptyAuthoredComponent(),
          name: `New ${family} pipe joint`,
          parts: tmpl.parts,
          design_space: tmpl.design_space,
        };
      } catch (e: any) {
        saveError = `family seed failed: ${e?.message ?? e}`;
      }
    } else if (prim) {
      // ?prim=<id> from /primitives → seed a new component containing one
      // part of that primitive at its default params.
      const def = COMPONENTS.find((c) => c.id === prim);
      if (def) {
        spec = {
          ...emptyAuthoredComponent(),
          name: `New ${def.name}`,
          parts: [{ id: 'p0', prim: def.id, params: structuredClone(def.defaults) }],
        };
      } else {
        saveError = `unknown primitive: "${prim}"`;
      }
    }
  });

  async function saveSpec() {
    if (spec.parts.length === 0) {
      saveError = 'Add at least one part before saving.';
      return;
    }
    if (!spec.name.trim()) {
      saveError = 'Give the component a name before saving.';
      return;
    }
    saving = true;
    saveError = null;
    saveNotice = null;
    try {
      // Grab a thumbnail from the live canvas so the cache has something
      // to fingerprint. Best-effort — a missing canvas just means no hash.
      let thumbnail: string | undefined;
      const canvas = document.querySelector('.viewport canvas') as HTMLCanvasElement | null;
      if (canvas) {
        try { thumbnail = canvas.toDataURL('image/png'); } catch {}
      }
      const payload = { ...spec, thumbnail_b64: thumbnail };
      const r = await fetch('/api/author/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`${r.status} ${err}`);
      }
      const result = await r.json();
      spec.id = result.id;
      saveNotice = `Saved as ${result.id} (${result.total} total)`;
    } catch (e: any) {
      saveError = e?.message ?? String(e);
    } finally {
      saving = false;
    }
  }

  // Narrow the rebuild trigger to ONLY the build-affecting fields (parts +
  // ops). Previously this watched JSON.stringify(spec) which fired on every
  // metadata keystroke (Name, Description, Tags) AND on authoring_log
  // pushes — each one a 1-3 second rebuild → page felt frozen "after
  // loading". Geometry doesn't depend on metadata, so no rebuild needed.
  let buildKey = $derived(JSON.stringify({ parts: spec.parts, ops: spec.ops }));

  // Debounce slider drags. Without this, each oninput on a number/range
  // input fires a rebuild — a slider drag = 50+ rebuilds queued. Coalesce
  // to a single build per 200ms idle period.
  let buildTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const _k = buildKey;
    if (!ready) return;
    if (spec.parts.length === 0) {
      geo = null;
      buildError = null;
      return;
    }
    if (buildTimer) clearTimeout(buildTimer);
    buildTimer = setTimeout(async () => {
      const t0 = performance.now();
      try {
        geo = await buildAuthored(spec);
        geoVersion++;
        buildTime = performance.now() - t0;
        buildError = null;
      } catch (e: any) {
        buildError = e?.message ?? String(e);
      }
    }, 200);
  });

  function nextPartId(): string {
    let n = 0;
    while (spec.parts.some(p => p.id === `p${n}`)) n++;
    return `p${n}`;
  }

  function nextOpId(): string {
    let n = 0;
    while (spec.ops.some(o => o.out === `op${n}`)) n++;
    return `op${n}`;
  }

  function addPart() {
    const defaultPrim = COMPONENTS[0];
    const part: AuthoredPart = {
      id: nextPartId(),
      prim: defaultPrim.id,
      params: structuredClone(defaultPrim.defaults),
    };
    spec.parts = [...spec.parts, part];
    logStep('user', 'add_part', part);
  }

  function removePart(idx: number) {
    const removed = spec.parts[idx];
    spec.parts = spec.parts.filter((_, i) => i !== idx);
    spec.ops = spec.ops.filter(o => !o.inputs.includes(removed.id));
    logStep('user', 'remove_part', { id: removed.id });
  }

  function changePrim(idx: number, newPrim: string) {
    const def = COMPONENTS.find(c => c.id === newPrim);
    if (!def) return;
    spec.parts[idx].prim = newPrim;
    spec.parts[idx].params = structuredClone(def.defaults);
  }

  function addOp() {
    if (spec.parts.length < 2 && spec.ops.length === 0) return;
    const availableIds = [...spec.parts.map(p => p.id), ...spec.ops.map(o => o.out)];
    const op: AuthoredOp = {
      op: 'union',
      inputs: availableIds.slice(0, 2),
      out: nextOpId(),
    };
    spec.ops = [...spec.ops, op];
    logStep('user', 'add_op', op);
  }

  function removeOp(idx: number) {
    const removed = spec.ops[idx];
    spec.ops = spec.ops
      .filter((_, i) => i !== idx)
      .filter(o => !o.inputs.includes(removed.out));
    logStep('user', 'remove_op', { out: removed.out });
  }

  function paramDef(primId: string, key: string) {
    const def = COMPONENTS.find(c => c.id === primId);
    return def?.params[key];
  }

  function availableIdsFor(opIdx: number): string[] {
    const partIds = spec.parts.map(p => p.id);
    const priorOpIds = spec.ops.slice(0, opIdx).map(o => o.out);
    return [...partIds, ...priorOpIds];
  }
</script>

<div class="layout">
  <!-- LEFT PANEL: library list. Click a card to load that component into the
       workbench. Replaces the old standalone /library grid. -->
  <div class="sidebar lib-list" class:collapsed={!showLibrary}>
    <button class="panel-toggle" onclick={toggleLibrary} aria-expanded={showLibrary} title={showLibrary ? 'Hide library' : 'Show library'}>
      <span class="ph-title">Library</span>
      <span class="caret">{showLibrary ? '◂' : '▸'}</span>
    </button>
    {#if showLibrary}
      <div class="lib-actions">
        <button class="lib-action" onclick={() => { spec = emptyAuthoredComponent(); const u = new URL(window.location.href); u.searchParams.delete('id'); window.history.replaceState({}, '', u); }}>+ New</button>
        <button class="lib-action" onclick={loadLibrary} title="Refresh">↻</button>
      </div>
      {#if libLoading}
        <div class="empty">Loading…</div>
      {:else if libError}
        <div class="empty" style="color:#cc2222">{libError}</div>
      {:else if libRecords.length === 0}
        <div class="empty">No library items yet. Generate via <code>bun run scripts/generate_authored_library.ts</code> or compose one →</div>
      {:else}
        {#each libRecords as r (r.id)}
          <button class="lib-card" class:active={spec.id === r.id} onclick={() => selectLibraryItem(r.id)}>
            <div class="lib-name">{r.name}</div>
            <div class="lib-meta">{r.parts_count} parts · {r.source.replace('_', ' ')}</div>
            {#if r.tags.length > 0}
              <div class="lib-tags">{r.tags.slice(0, 3).join(' · ')}</div>
            {/if}
          </button>
        {/each}
      {/if}
    {/if}
  </div>

  <div class="viewport">
    <div class="vp-header">
      Authored Component <span class="ms">{buildTime.toFixed(0)}ms · {spec.parts.length} parts · {spec.ops.length} ops</span>
    </div>
    {#if buildError}
      <div class="err">Error: {buildError}</div>
    {/if}
    {#if SceneComponent && geo}
      <Canvas {createRenderer}>
        {@const Scene = SceneComponent}
        <Scene {geo} {geoVersion} {showCutaway} {showEdges} />
      </Canvas>
    {:else if !buildError}
      <div class="empty-viewport">Add a part to see the preview.</div>
    {/if}
    {#if SceneControls}
      {@const Controls = SceneControls}
      <Controls />
    {/if}
    <div class="controls">
      <label><input type="checkbox" bind:checked={showCutaway} /> Cross-section</label>
      <label><input type="checkbox" bind:checked={showEdges} /> Edges</label>
    </div>
  </div>

  <!-- RIGHT PANEL: metadata (top) + parts/ops editor (bottom). -->
  <div class="meta" class:collapsed={!showEdit}>
    <button class="panel-toggle" onclick={toggleEdit} aria-expanded={showEdit} title={showEdit ? 'Hide editor' : 'Show editor'}>
      <span class="ph-title">Edit</span>
      <span class="caret">{showEdit ? '▸' : '◂'}</span>
    </button>
    {#if showEdit}
      <div class="single-header">Components</div>

      <!-- Parts & ops editor — the per-instance design. Methodology surface
           (archetypes / families coverage) moved to /families. Primitive
           browsing moved to /primitives. -->
      <div class="sec">
        <div class="sec-h">Parts <button class="add" onclick={addPart}>+</button></div>
        {#if spec.parts.length === 0}
          <div class="empty">No parts — click + to add a primitive.</div>
        {/if}
        {#each spec.parts as part, i}
          <div class="part">
            <div class="part-head">
              <span class="pid">{part.id}</span>
              <select bind:value={part.prim} onchange={(e) => changePrim(i, (e.target as HTMLSelectElement).value)}>
                {#each COMPONENTS as c}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
              <button class="rm" onclick={() => removePart(i)}>×</button>
            </div>
            <div class="params">
              {#each Object.keys(part.params) as key}
                {@const def = paramDef(part.prim, key)}
                {#if def}
                  <div class="pr">
                    <span class="lbl">{def.label}</span>
                    <input type="range" min={def.min} max={def.max} step={def.step} bind:value={part.params[key]} />
                    <input type="number" step={def.step} bind:value={part.params[key]} />
                  </div>
                {/if}
              {/each}
            </div>
            <details class="tx">
              <summary>Transform</summary>
              <div class="tx-grid">
                <label>tx<input type="number" step="0.1" value={part.transform?.tx ?? 0} oninput={(e) => {
                  part.transform = { ...part.transform, tx: parseFloat((e.target as HTMLInputElement).value) || 0 };
                }} /></label>
                <label>ty<input type="number" step="0.1" value={part.transform?.ty ?? 0} oninput={(e) => {
                  part.transform = { ...part.transform, ty: parseFloat((e.target as HTMLInputElement).value) || 0 };
                }} /></label>
                <label>tz<input type="number" step="0.1" value={part.transform?.tz ?? 0} oninput={(e) => {
                  part.transform = { ...part.transform, tz: parseFloat((e.target as HTMLInputElement).value) || 0 };
                }} /></label>
                <label>rx<input type="number" step="0.1" value={part.transform?.rx ?? 0} oninput={(e) => {
                  part.transform = { ...part.transform, rx: parseFloat((e.target as HTMLInputElement).value) || 0 };
                }} /></label>
                <label>ry<input type="number" step="0.1" value={part.transform?.ry ?? 0} oninput={(e) => {
                  part.transform = { ...part.transform, ry: parseFloat((e.target as HTMLInputElement).value) || 0 };
                }} /></label>
                <label>rz<input type="number" step="0.1" value={part.transform?.rz ?? 0} oninput={(e) => {
                  part.transform = { ...part.transform, rz: parseFloat((e.target as HTMLInputElement).value) || 0 };
                }} /></label>
              </div>
            </details>
          </div>
        {/each}
      </div>

      <div class="sec">
        <div class="sec-h">Ops <button class="add" onclick={addOp} disabled={spec.parts.length < 2}>+</button></div>
        {#if spec.ops.length === 0}
          <div class="empty">No ops — parts will be unioned implicitly.</div>
        {/if}
        {#each spec.ops as op, i}
          <div class="op">
            <div class="op-head">
              <span class="pid">{op.out}</span>
              <select bind:value={op.op}>
                <option value="union">union</option>
                <option value="subtract">subtract</option>
                <option value="intersect">intersect</option>
              </select>
              <button class="rm" onclick={() => removeOp(i)}>×</button>
            </div>
            <div class="op-inputs">
              {#each op.inputs as _, inIdx}
                <select bind:value={op.inputs[inIdx]}>
                  {#each availableIdsFor(i) as id}
                    <option value={id}>{id}</option>
                  {/each}
                </select>
              {/each}
              <button class="add-in" onclick={() => {
                op.inputs = [...op.inputs, availableIdsFor(i)[0] ?? ''];
              }}>+ input</button>
              {#if op.inputs.length > 2}
                <button class="rm-in" onclick={() => {
                  op.inputs = op.inputs.slice(0, -1);
                }}>− input</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- 3. Metadata + save. -->
      <div class="meta-fields sec-divider">
        <div class="sec-h">Metadata</div>
        <label>ID<input type="text" bind:value={spec.id} placeholder="e.g. my_sub" /></label>
        <label>Name<input type="text" bind:value={spec.name} placeholder="e.g. My Bottom Sub" /></label>
        <label>Description<textarea bind:value={spec.description} rows="3" placeholder="What is this component?"></textarea></label>
        <label>Tags<input type="text" placeholder="comma,separated" oninput={(e) => {
          spec.tags = (e.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean);
        }} /></label>
        <button class="save" onclick={saveSpec} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {#if saveError}<div class="save-msg err">{saveError}</div>{/if}
        {#if saveNotice}<div class="save-msg ok">{saveNotice}</div>{/if}
      </div>
    {/if}
  </div>

  {#if ChatPanel}
    {@const Panel = ChatPanel}
    <Panel />
  {/if}
</div>

<style>
  .layout { display: flex; height: 100%; font-family: Arial, sans-serif; }
  .sidebar { width: 320px; min-width: 320px; background: #f5f5f5; border-right: 1px solid #ddd; overflow-y: auto; padding: 8px; }
  .sec { margin-bottom: 16px; }
  .sec-h { display: flex; justify-content: space-between; align-items: center; font: bold 11px Arial; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .add { background: #cc2222; color: white; border: none; border-radius: 3px; padding: 2px 8px; font-weight: bold; cursor: pointer; font-size: 12px; }
  .add:disabled { background: #aaa; cursor: not-allowed; }
  .empty { font: 10px Arial; color: #999; padding: 4px 0; }
  .part, .op { background: white; border: 1px solid #e0e0e0; border-radius: 4px; padding: 6px; margin-bottom: 6px; }
  .part-head, .op-head { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
  .pid { font: bold 10px monospace; background: #eee; padding: 2px 6px; border-radius: 3px; color: #555; }
  .part-head select, .op-head select, .op-inputs select { flex: 1; font-size: 11px; padding: 2px 4px; border: 1px solid #ddd; border-radius: 3px; }
  .rm { background: #eee; border: none; color: #888; cursor: pointer; padding: 0 6px; border-radius: 3px; font-size: 14px; }
  .rm:hover { background: #ffd6d6; color: #cc2222; }
  .pr { display: flex; align-items: center; gap: 4px; margin: 2px 0; }
  .lbl { width: 60px; font-size: 9px; color: #777; flex-shrink: 0; }
  .pr input[type="range"] { flex: 1; height: 3px; accent-color: #cc2222; }
  .pr input[type="number"] { width: 40px; font: 9px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 1px 3px; text-align: right; }
  .tx summary { font-size: 10px; color: #666; cursor: pointer; padding: 2px 0; }
  .tx-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; padding: 4px; }
  .tx-grid label { font-size: 9px; color: #777; display: flex; flex-direction: column; gap: 1px; }
  .tx-grid input { width: 100%; font: 9px monospace; border: 1px solid #ddd; border-radius: 2px; padding: 1px 3px; box-sizing: border-box; }
  .op-inputs { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; }
  .add-in, .rm-in { font: 9px Arial; background: #eee; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; color: #666; }
  .viewport { flex: 1; position: relative; min-width: 0; background: white; }
  .vp-header { position: absolute; top: 8px; left: 16px; font: bold 13px Arial; color: #333; z-index: 10; }
  .ms { font-size: 9px; color: #888; font-weight: normal; margin-left: 6px; }
  .err { position: absolute; top: 40px; left: 16px; right: 16px; background: #ffe0e0; border: 1px solid #cc2222; color: #cc2222; padding: 8px; border-radius: 4px; font: 11px monospace; z-index: 20; }
  .empty-viewport { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
  .controls { position: absolute; bottom: 12px; right: 12px; display: flex; gap: 8px; background: rgba(255,255,255,0.9); padding: 6px 10px; border-radius: 4px; z-index: 10; }
  .controls label { font-size: 11px; display: flex; gap: 4px; align-items: center; cursor: pointer; }
  .meta { width: 320px; min-width: 320px; background: #fafafa; border-left: 1px solid #ddd; padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
  .meta label { font: 10px Arial; color: #666; display: flex; flex-direction: column; gap: 2px; }
  .meta input, .meta textarea { font: 11px Arial; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-family: Arial, sans-serif; }
  .save { margin-top: auto; background: #cc2222; color: white; border: none; padding: 8px; border-radius: 4px; font: bold 12px Arial; cursor: pointer; }
  .save:disabled { background: #aaa; cursor: not-allowed; }
  .save-msg { font: 10px Arial; padding: 6px 8px; border-radius: 3px; margin-top: 4px; }
  .save-msg.err { background: #f8d7da; color: #721c24; }
  .save-msg.ok { background: #d1e7dd; color: #0f5132; }

  /* Left library list panel — replaces standalone /library page. Card list
     where the active component is highlighted, click = load into workbench. */
  .lib-list { background: #f8f8f8; }
  .lib-actions { display: flex; gap: 4px; margin-bottom: 8px; }
  .lib-action {
    flex: 1; padding: 4px 8px; font: bold 11px Arial; cursor: pointer;
    background: #fff; border: 1px solid #ddd; border-radius: 3px; color: #333;
  }
  .lib-action:hover { background: #f0f0f0; }
  .lib-card {
    display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 6px;
    background: white; border: 1px solid #e0e0e0; border-radius: 4px; cursor: pointer;
    font-family: inherit; transition: border-color 100ms, background 100ms;
  }
  .lib-card:hover { background: #fafafa; border-color: #ccc; }
  .lib-card.active { background: #fef0f0; border-color: #cc2222; }
  .lib-name { font: bold 12px Arial; color: #222; line-height: 1.3; margin-bottom: 3px; }
  .lib-meta { font: 10px Arial; color: #888; margin-bottom: 2px; }
  .lib-tags { font: 9px Arial; color: #aaa; }

  /* Right-panel single "Components" view (was previously 3 tabs:
     Parameters / Metadata / Library). All sections stack in one scrollable
     column — methodology surface on top, parts/ops editor in the middle,
     metadata at the bottom. Sec-divider draws a thin rule between them. */
  .meta-fields { display: flex; flex-direction: column; gap: 6px; }
  .single-header {
    margin: -2px -10px 10px;
    padding: 8px 14px;
    background: #f0f0f0;
    border-bottom: 1px solid #ddd;
    font: bold 11px Arial;
    color: #cc2222;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .sec-divider { padding-top: 8px; margin-top: 8px; border-top: 1px solid #e5e5e5; }

  /* (Family-taxonomy panel moved to /families; styles removed.) */

  /* Collapse toggle. Header bar stays clickable; body hidden when collapsed.
     Collapsed sidebar/meta shrink to a thin sliver with a vertical-text title
     so you can re-expand. Persisted choice via localStorage in the script. */
  .panel-toggle {
    width: 100%; display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; margin: -8px -8px 8px -8px;
    background: #ececec; border: none; border-bottom: 1px solid #ddd;
    cursor: pointer; font: bold 12px Arial; color: #333;
  }
  .panel-toggle:hover { background: #e0e0e0; }
  .panel-toggle .caret { font-size: 11px; color: #666; }

  .sidebar.collapsed,
  .meta.collapsed {
    width: 36px; min-width: 36px; padding: 0; overflow: hidden;
  }
  .sidebar.collapsed .panel-toggle,
  .meta.collapsed .panel-toggle {
    margin: 0; height: 100%; flex-direction: column; gap: 8px;
    border-bottom: none; padding: 12px 4px;
  }
  .sidebar.collapsed .panel-toggle .ph-title,
  .meta.collapsed .panel-toggle .ph-title {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
  }

  /* Below 900px, stack: parts/ops sidebar → 3D viewport → metadata.
     Sidebar gets a max-height so it doesn't push the 3D off-screen on phones. */
  @media (max-width: 900px) {
    .layout { flex-direction: column; height: auto; min-height: 100%; overflow-y: auto; }
    .sidebar {
      width: 100%; min-width: 0; max-height: 280px; overflow-y: auto;
      border-right: none; border-bottom: 1px solid #ddd;
    }
    .viewport { width: 100%; min-height: 380px; flex-shrink: 0; }
    .meta {
      width: 100%; min-width: 0; border-left: none; border-top: 1px solid #ddd;
    }
  }
</style>
