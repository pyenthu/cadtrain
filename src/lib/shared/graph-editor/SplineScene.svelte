<!--
  SplineScene.svelte — the Threlte 3D scene INSIDE SplineEditorPopup's <Canvas>
  (TODO #15, the spline-editor path card). Lives as a child of <Canvas> so it can
  call useThrelte() for the active camera + on-demand invalidate().

  Renders, for a `spline` node's control points:
    • draggable spheres at each control point (interactivity() pointerdown +
      a manual DOM-level pointermove that ray-casts onto a camera-facing drag
      plane — OrbitControls is suspended while a handle is held),
    • the centripetal Catmull-Rom curve through them (THREE.CatmullRomCurve3 —
      THREE is fine here, only the Manifold BAKE must stay three-free; the bake
      recomputes the same curve with the pure-JS resampleSpline), and
    • small markers at the N equally-spaced ARC-LENGTH samples (resampleSpline) —
      the exact points the emitted part feeds into r_sweep.path.

  NO `three/examples/jsm/*` / `three/addons/*` — Canvas + T + OrbitControls +
  interactivity from @threlte/* only (the repo convention, see WellScene.svelte).
-->
<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls, interactivity } from '@threlte/extras';
  import * as THREE from 'three';
  import { resampleSpline, type Vec3 } from '$lib/cad/spline-resample';

  let {
    points,
    samples,
    selectedIdx = $bindable(-1),
    onPointsChange,
  }: {
    points: Vec3[];
    samples: number;
    /** Currently-selected control point (for the remove button + highlight). */
    selectedIdx?: number;
    onPointsChange: (pts: Vec3[]) => void;
  } = $props();

  interactivity();
  const { camera, renderer, invalidate } = useThrelte();

  // ─── derived geometry ─────────────────────────────────────────────────────
  const vecs = $derived(points.filter((p) => Array.isArray(p) && p.length >= 3));

  /** The smooth curve polyline (THREE.CatmullRomCurve3, dense). */
  let curveObj = $state<THREE.Line | null>(null);
  $effect(() => {
    const old = curveObj;
    if (vecs.length < 2) { curveObj = null; old?.geometry.dispose(); invalidate(); return; }
    const cps = vecs.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(cps, false, 'centripetal');
    const dense = curve.getPoints(Math.max(8, vecs.length * 32));
    const g = new THREE.BufferGeometry().setFromPoints(dense);
    const m = new THREE.LineBasicMaterial({ color: 0x7c3aed, linewidth: 2 });
    curveObj = new THREE.Line(g, m);
    old?.geometry.dispose();
    invalidate();
  });

  /** The N equally-arc-length-spaced samples (the BAKE output preview). */
  const sampledPts = $derived.by<Vec3[]>(() => {
    if (vecs.length < 2) return [];
    try { return resampleSpline(vecs as Vec3[], Math.max(2, samples)); } catch { return []; }
  });

  /** Auto-fit target = centroid of the control points (OrbitControls focus). */
  const center = $derived.by<[number, number, number]>(() => {
    if (vecs.length === 0) return [0, 0, 0];
    const s = vecs.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return [s[0] / vecs.length, s[1] / vecs.length, s[2] / vecs.length];
  });

  // ─── dragging a control point ─────────────────────────────────────────────
  let draggingIdx = $state(-1);
  // Pointer is hovering a handle → suspend OrbitControls BEFORE any press, so a
  // pointerdown on a sphere never reaches an enabled control (avoids the
  // reactive-lag race where orbit grabs the same pointerdown). Real mouse use
  // always hovers first; the drag keeps it suspended via draggingIdx.
  let hoverIdx = $state(-1);
  const orbitEnabled = $derived(draggingIdx < 0 && hoverIdx < 0);
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  function onSphereDown(i: number, e: any) {
    e.stopPropagation?.();
    selectedIdx = i;
    draggingIdx = i;
    // Drag plane = perpendicular to the view direction, through the point — so
    // the handle tracks the cursor regardless of orbit angle.
    const cam = camera.current;
    cam.getWorldDirection(camDir);
    const p = vecs[i]!;
    plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(p[0], p[1], p[2]));
    const native = e.nativeEvent as PointerEvent | undefined;
    try { (native?.target as Element | undefined)?.setPointerCapture?.(native!.pointerId); } catch { /* ignore */ }
  }

  function onMove(ev: PointerEvent) {
    if (draggingIdx < 0) return;
    const dom = renderer?.domElement;
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera.current);
    if (ray.ray.intersectPlane(plane, hit)) {
      const next = points.map((p, k): Vec3 => (k === draggingIdx ? [hit.x, hit.y, hit.z] : (p as Vec3)));
      onPointsChange(next);
    }
  }
  function onUp() { if (draggingIdx >= 0) { draggingIdx = -1; hoverIdx = -1; } }

  // DOM-level move/up so the drag keeps tracking even when the cursor leaves the
  // sphere (interactivity() only fires while OVER a mesh).
  $effect(() => {
    const dom = renderer?.domElement;
    if (!dom) return;
    dom.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });
</script>

<T.PerspectiveCamera makeDefault position={[8, 6, 10]} fov={45}>
  <OrbitControls enableDamping enabled={orbitEnabled} target={center} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.8} />
<T.DirectionalLight position={[10, 15, 10]} intensity={1.1} />
<T.GridHelper args={[20, 20, 0xcccccc, 0xeeeeee]} />
<T.AxesHelper args={[3]} />

<!-- the smooth Catmull-Rom curve -->
{#if curveObj}
  <T is={curveObj} />
{/if}

<!-- N equally-spaced arc-length samples (the emitted r_sweep.path) -->
{#each sampledPts as sp, i (i)}
  <T.Mesh position={[sp[0], sp[1], sp[2]]}>
    <T.SphereGeometry args={[0.07, 8, 8]} />
    <T.MeshBasicMaterial color={0x10b981} />
  </T.Mesh>
{/each}

<!-- draggable control points -->
{#each vecs as p, i (i)}
  <T.Mesh
    position={[p[0], p[1], p[2]]}
    onpointerenter={() => (hoverIdx = i)}
    onpointerleave={() => { if (draggingIdx < 0) hoverIdx = -1; }}
    onpointerdown={(e: any) => onSphereDown(i, e)}>
    <T.SphereGeometry args={[0.28, 16, 16]} />
    <T.MeshStandardMaterial
      color={i === selectedIdx ? 0xf59e0b : 0x7c3aed}
      emissive={i === draggingIdx ? 0xf59e0b : 0x000000}
      emissiveIntensity={0.5} />
  </T.Mesh>
{/each}
