<script lang="ts">
  // PrimitiveBrepView — renders a part via the SERVER-SIDE OCCT (BREP) pipeline
  // (/api/brep/preview). Posts the part's emitted source + current param values;
  // the server extracts the revolve (r,z) profile, revolves it in OpenCascade,
  // adaptively tessellates, and returns an INDEXED mesh with exact-surface
  // normals. Rendered here in a minimal raw-Three scene (smooth-shaded) so it
  // sits next to the Manifold (3D bake) + GLB tabs for comparison.
  //
  // v1: revolve parts only — parts with no top-level r_revolve come back
  // supported:false and the view shows "no BREP path for this part".
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

  let { source = '', paramValues = {}, name = 'part', active = false }:
    { source?: string; paramValues?: Record<string, number>; name?: string; active?: boolean } = $props();

  let host: HTMLDivElement;
  let status = $state<'idle' | 'building' | 'ok' | 'empty' | 'error'>('idle');
  let info = $state<string>('');
  let stats = $state<{ tris: number; verts: number; ms: number } | null>(null);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let mesh: THREE.Mesh | null = null;
  let raf = 0;

  function setup() {
    if (!host) return;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#f2f3f5');
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    camera.position.set(20, 12, 20);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(-70, 70, 40);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(50, -30, -40);
    scene.add(dir2);
    resize();
    const loop = () => { raf = requestAnimationFrame(loop); controls?.update(); if (renderer && scene && camera) renderer.render(scene, camera); };
    loop();
  }

  function resize() {
    if (!renderer || !camera || !host) return;
    const w = host.clientWidth || 400, h = host.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function fit(geo: THREE.BufferGeometry) {
    if (!camera || !controls) return;
    geo.computeBoundingSphere();
    const s = geo.boundingSphere; if (!s) return;
    controls.target.copy(s.center);
    const d = s.radius * 2.6;
    camera.position.copy(s.center).add(new THREE.Vector3(d * 0.7, d * 0.5, d * 0.7));
    camera.near = Math.max(0.01, s.radius / 100); camera.far = s.radius * 100;
    camera.updateProjectionMatrix(); controls.update();
  }

  async function rebuild() {
    if (!active || !source || !scene) return;
    status = 'building'; info = ''; stats = null;
    try {
      const r = await fetch('/api/brep/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, paramValues, tolerance: 0.05 }),
      });
      const data = await r.json();
      if (!r.ok) { status = 'error'; info = data?.message ?? `HTTP ${r.status}`; return; }
      if (!data.supported) { status = 'empty'; info = data.reason ?? 'no BREP path'; return; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.positions), 3));
      if (data.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
      if (data.normals) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.normals), 3));
      else geo.computeVertexNormals();
      if (mesh) { scene.remove(mesh); (mesh.geometry as any)?.dispose?.(); (mesh.material as any)?.dispose?.(); }
      const mat = new THREE.MeshStandardMaterial({ color: '#c0613a', metalness: 0.15, roughness: 0.5, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      fit(geo);
      stats = data.meta; status = 'ok';
    } catch (e: any) { status = 'error'; info = String(e?.message ?? e); }
  }

  onMount(() => { setup(); const ro = new ResizeObserver(resize); if (host) ro.observe(host); return () => ro.disconnect(); });
  onDestroy(() => { cancelAnimationFrame(raf); controls?.dispose(); renderer?.dispose(); renderer?.domElement?.remove(); });

  // Rebuild when the tab activates or the part/source changes.
  let lastKey = '';
  $effect(() => {
    const key = active ? source + '|' + JSON.stringify(paramValues) : '';
    if (active && scene && key && key !== lastKey) { lastKey = key; rebuild(); }
  });
</script>

<div class="brep-wrap">
  <div class="brep-host" bind:this={host}></div>
  <div class="brep-hud">
    <span class="brep-title">{name} · BREP <span class="brep-kernel">OCCT</span></span>
    {#if status === 'building'}<span class="brep-stat">tessellating…</span>
    {:else if status === 'ok' && stats}<span class="brep-stat ok">{stats.tris.toLocaleString()} tris · {stats.verts.toLocaleString()} verts · {stats.ms}ms · adaptive</span>
    {:else if status === 'empty'}<span class="brep-stat warn">{info}</span>
    {:else if status === 'error'}<span class="brep-stat err">⚠ {info}</span>{/if}
  </div>
</div>

<style>
  .brep-wrap { position: relative; width: 100%; height: 100%; min-height: 300px; }
  .brep-host { position: absolute; inset: 0; }
  .brep-hud { position: absolute; left: 10px; top: 8px; display: flex; flex-direction: column; gap: 3px; pointer-events: none; font: 12px Arial, sans-serif; }
  .brep-title { font-weight: 700; color: #b23a1a; }
  .brep-kernel { font-weight: 400; font-size: 10px; color: #fff; background: #7a5; padding: 1px 5px; border-radius: 3px; vertical-align: middle; }
  .brep-stat { color: #555; font-size: 11px; }
  .brep-stat.ok { color: #2a7; }
  .brep-stat.warn { color: #a70; }
  .brep-stat.err { color: #c33; }
</style>
