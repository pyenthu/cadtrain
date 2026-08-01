<script lang="ts">
  // Cad3d — the interactive 3D CAD viewer, a CLIENT ISLAND (dataMode:'client'). 3D can't
  // server-render (no server WebGL), so this component renders an SSR-safe placeholder <div> (sized
  // by `height` so the server HTML is valid) and mounts the WebGL canvas in onMount, guarded by
  // `browser`. Three/Threlte + the scene are LAZY-imported inside onMount so nothing WebGL touches
  // the SSR pass (svelte/server render() skips onMount/$effect).
  //
  // Geometry comes SERVER-baked (computeMode:'server'): we POST { partId, params, cutaway } to
  // /api/app/cad-bake, which loads the part SOURCE server-side, bakes it, and returns the serialized
  // MESH — the engine + the source never reach the client. (computeMode:'client' worker-bake is a
  // future follow-up.) See src/lib/app_components/CLAUDE.md + docs/plans/app-server-render.md.
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';

  let {
    panel,
    params,
    vars,
  }: {
    panel: Panel;
    params?: Record<string, unknown>;
    vars?: Record<string, unknown>;
  } = $props();

  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const scope = $derived({ params, vars });

  // props (resolve $params/$vars refs) — partId · params · cutaway · height · background · autoRotate.
  const partId = $derived(String(resolveRef(p.partId, scope) ?? '').trim());
  const cutaway = $derived(resolveRef(p.cutaway, scope) === true || resolveRef(p.cutaway, scope) === 'true');
  const autoRotate = $derived(
    resolveRef(p.autoRotate, scope) === true || resolveRef(p.autoRotate, scope) === 'true',
  );
  const height = $derived.by(() => {
    const h = Number(resolveRef(p.height, scope));
    return Number.isFinite(h) && h > 0 ? h : 360;
  });
  const background = $derived(p.background ? String(p.background) : '#ffffff');
  // `params` prop: a $vars/$params ref resolving to a record, an inline object, or a JSON string.
  const paramsVal = $derived.by<Record<string, unknown> | undefined>(() => {
    const v = resolveRef(p.params, scope);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return undefined;
      try {
        const parsed = JSON.parse(t);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  });

  // Lazy-loaded client modules (Threlte Canvas + the trimmed scene + the mesh deserializer). Null
  // until onMount resolves them → the SSR pass + the first client paint show the placeholder.
  let mod = $state<{ Canvas: any; Scene: any; deserialize: (s: any) => any } | null>(null);
  let geo = $state<any>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let errMsg = $state('');
  const ready = $derived(!!mod && !!geo && status === 'ready');

  onMount(async () => {
    if (!browser) return;
    try {
      const [core, sceneMod, serial] = await Promise.all([
        import('@threlte/core'),
        import('./Cad3dScene.svelte'),
        import('$lib/engines/manifold/mesh-serial'),
      ]);
      mod = { Canvas: core.Canvas, Scene: sceneMod.default, deserialize: serial.deserializeComponentResult };
    } catch (e: any) {
      errMsg = `viewer failed to load: ${e?.message ?? e}`;
      status = 'error';
    }
  });

  // Re-bake whenever partId / params / cutaway change (once the modules are loaded). bakeKey tracks
  // the inputs; the abort flag drops a stale response if a newer bake supersedes it.
  const bakeKey = $derived(JSON.stringify({ partId, params: paramsVal ?? null, cutaway }));
  $effect(() => {
    void bakeKey; // track partId / paramsVal / cutaway
    const m = mod;
    if (!m) return;
    if (!partId) {
      geo = null;
      status = 'idle';
      return;
    }
    let cancelled = false;
    status = 'loading';
    errMsg = '';
    (async () => {
      try {
        const res = await fetch('/api/app/cad-bake', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ partId, params: paramsVal, cutaway }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data || data.ok !== true) {
          errMsg = (data && (data.error || data.message)) || `bake failed (${res.status})`;
          status = 'error';
          geo = null;
          return;
        }
        // deserializeComponentResult({ full, cutVC, parts?, cutParts? }) → THREE.BufferGeometry pair.
        geo = m.deserialize(data);
        status = 'ready';
      } catch (e: any) {
        if (!cancelled) {
          errMsg = `bake failed: ${e?.message ?? e}`;
          status = 'error';
          geo = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="cad3d" style:height="{height}px">
  {#if ready}
    {@const C = mod!.Canvas}
    {@const S = mod!.Scene}
    <C frameloop={autoRotate ? 'always' : 'demand'}>
      <S {geo} {cutaway} {background} {autoRotate} />
    </C>
  {:else if status === 'error'}
    <div class="c3-msg c3-err">⚠ {errMsg}</div>
  {:else}
    <div class="c3-msg">{partId ? '⏳ baking 3D…' : 'set a partId'}</div>
  {/if}
</div>

<style>
  .cad3d {
    position: relative;
    width: 100%;
    min-height: 120px;
    border: 1px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
    background: var(--h-surface, #ffffff);
  }
  .c3-msg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 500 12px system-ui;
    color: var(--h-muted, #94a3b8);
    text-align: center;
    padding: 8px;
  }
  .c3-err {
    color: #dc2626;
    font-style: italic;
  }
</style>
