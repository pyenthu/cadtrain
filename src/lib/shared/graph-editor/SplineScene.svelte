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
    closed = false,
    interactive = true,
    selectedIdx = $bindable(-1),
    onPointsChange,
  }: {
    points: Vec3[];
    samples: number;
    /** Loop the curve (last→first). Mirrors the spline node's `closed` flag. */
    closed?: boolean;
    /** When false, the control points are READ-ONLY (dragging + click-to-insert
     *  are disabled): the handles come from a WIRED expression (#26), not manual
     *  editing. Orbit + the samples/curve still render. */
    interactive?: boolean;
    /** Currently-selected control point (for the remove button + highlight). */
    selectedIdx?: number;
    onPointsChange: (pts: Vec3[]) => void;
  } = $props();

  interactivity();
  const { camera, renderer, invalidate } = useThrelte();

  // XYZ axes for the spline path editor — visible colored tubes + arrowheads
  // (X red · Y green · Z blue), so orientation reads at a glance. Plain meshes
  // (no font/CDN dependency → offline-safe). Cylinder/cone default to +Y; the
  // rotation aligns each to its axis, positioned from the origin outward.
  const AXIS_LEN = 6;
  const AXES = [
    { key: 'x', c: 0xef4444, pos: [AXIS_LEN / 2, 0, 0], tip: [AXIS_LEN, 0, 0], rot: [0, 0, -Math.PI / 2] },
    { key: 'y', c: 0x22c55e, pos: [0, AXIS_LEN / 2, 0], tip: [0, AXIS_LEN, 0], rot: [0, 0, 0] },
    { key: 'z', c: 0x3b82f6, pos: [0, 0, AXIS_LEN / 2], tip: [0, 0, AXIS_LEN], rot: [Math.PI / 2, 0, 0] },
  ];

  // ─── derived geometry ─────────────────────────────────────────────────────
  const vecs = $derived(points.filter((p) => Array.isArray(p) && p.length >= 3));

  /** The smooth curve polyline (THREE.CatmullRomCurve3, dense). */
  // The curve is a thin TUBE mesh (not a Line): it raycasts reliably for
  // click-to-insert, casts a shadow, and reads as 3D.
  let curveObj = $state<THREE.Object3D | null>(null);
  $effect(() => {
    // Depend ONLY on `vecs` — never read `curveObj` here, or this effect would
    // depend on the very state it writes and re-fire forever (effect_update_depth
    // → frozen main thread → the popup can't close/add/edit). Old geometry is
    // freed in the cleanup return when `vecs` changes or the scene unmounts.
    if (vecs.length < 2) { curveObj = null; invalidate(); return; }
    const cps = vecs.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(cps, closed, 'centripetal');
    const g = new THREE.TubeGeometry(curve, Math.max(16, vecs.length * 24), 0.06, 10, closed);
    const m = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.5 });
    curveObj = new THREE.Mesh(g, m);
    invalidate();
    return () => { g.dispose(); m.dispose(); };
  });

  /** Ground PROJECTION of the curve — control points flattened to y=0, a thin
   *  grey tube on the grid (the curve's footprint). A depth read, not a shadow. */
  let projObj = $state<THREE.Object3D | null>(null);
  $effect(() => {
    if (vecs.length < 2) { projObj = null; invalidate(); return; }
    const flat = vecs.map((p) => new THREE.Vector3(p[0], 0, p[2]));
    const curve = new THREE.CatmullRomCurve3(flat, closed, 'centripetal');
    const g = new THREE.TubeGeometry(curve, Math.max(16, vecs.length * 24), 0.03, 8, closed);
    const m = new THREE.MeshBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.5 });
    projObj = new THREE.Mesh(g, m);
    invalidate();
    return () => { g.dispose(); m.dispose(); };
  });

  /** Click on the curve → insert a control point at the clicked position,
   *  BETWEEN the two control points whose chord is nearest the click (so it
   *  lands in the middle of the run, not appended at the end). */
  function distToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
    return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
  }
  function onCurveClick(e: any) {
    if (!interactive) return;           // wired points are read-only (#26)
    e.stopPropagation?.();
    const P: THREE.Vector3 | undefined = e.point;
    if (!P || vecs.length < 2) return;
    let bestSeg = 0, bestD = Infinity;
    for (let i = 0; i < vecs.length - 1; i++) {
      const a = new THREE.Vector3(vecs[i]![0], vecs[i]![1], vecs[i]![2]);
      const b = new THREE.Vector3(vecs[i + 1]![0], vecs[i + 1]![1], vecs[i + 1]![2]);
      const d = distToSeg(P, a, b);
      if (d < bestD) { bestD = d; bestSeg = i; }
    }
    const next = points.slice();
    next.splice(bestSeg + 1, 0, [P.x, P.y, P.z] as Vec3);
    selectedIdx = bestSeg + 1;
    onPointsChange(next);
  }

  /** The N equally-arc-length-spaced samples (the BAKE output preview). */
  const sampledPts = $derived.by<Vec3[]>(() => {
    if (vecs.length < 2) return [];
    try { return resampleSpline(vecs as Vec3[], Math.max(2, samples), closed); } catch { return []; }
  });


  // ─── dragging a control point ─────────────────────────────────────────────
  let draggingIdx = $state(-1);
  // Pointer is hovering a handle → suspend OrbitControls BEFORE any press, so a
  // pointerdown on a sphere never reaches an enabled control (avoids the
  // reactive-lag race where orbit grabs the same pointerdown). Real mouse use
  // always hovers first; the drag keeps it suspended via draggingIdx.
  let hoverIdx = $state(-1);
  const orbitEnabled = $derived(draggingIdx < 0 && hoverIdx < 0);
  // Ref to the OrbitControls instance so a grab can disable it IMMEDIATELY
  // (imperatively) — the reactive `enabled` prop alone loses the event-order
  // race: OrbitControls' canvas pointerdown listener can fire + start an orbit
  // before Svelte re-renders the prop. We set .enabled in onSphereDown/onUp.
  let orbit = $state<any>(null);
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  // OrbitControls focus = centroid of the control points, but FROZEN during a
  // drag. If the target tracked the centroid live, moving a point would shift
  // the target → the camera pans/eases toward it every frame (looks like the
  // view keeps moving / rescaling while you drag). Recompute only when idle.
  let heldCenter = $state<[number, number, number]>([0, 0, 0]);
  $effect(() => {
    if (draggingIdx >= 0) return; // freeze focus mid-drag
    const n = vecs.length;
    if (n === 0) { heldCenter = [0, 0, 0]; return; }
    const s = vecs.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    heldCenter = [s[0] / n, s[1] / n, s[2] / n];
  });

  // CAPTURE-phase pointerdown on the canvas: if the press lands on a control
  // sphere, start the drag + lock the camera + stopImmediatePropagation so
  // OrbitControls (a bubble-phase listener on the same canvas) NEVER sees this
  // press → zero camera rotation while dragging a point. Empty-space presses
  // fall through untouched, so orbiting still works there. This is race-free
  // (capture runs before bubble), unlike relying on the reactive `enabled` prop.
  function onDown(ev: PointerEvent) {
    if (!interactive) return;           // wired points are read-only (#26) → orbit only
    const dom = renderer?.domElement;
    if (!dom || vecs.length === 0) return;
    const rect = dom.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera.current);
    let hitIdx = -1, hitAlong = Infinity;
    for (let i = 0; i < vecs.length; i++) {
      const c = new THREE.Vector3(vecs[i]![0], vecs[i]![1], vecs[i]![2]);
      if (ray.ray.distanceToPoint(c) <= 0.36) {
        const along = ray.ray.origin.distanceToSquared(c);
        if (along < hitAlong) { hitAlong = along; hitIdx = i; }
      }
    }
    if (hitIdx < 0) return; // empty space → leave it for OrbitControls
    ev.stopImmediatePropagation();
    selectedIdx = hitIdx;
    draggingIdx = hitIdx;
    if (orbit) orbit.enabled = false;
    const cam = camera.current;
    cam.getWorldDirection(camDir);
    const p = vecs[hitIdx]!;
    plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(p[0], p[1], p[2]));
    try { dom.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
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
      const r3 = (v: number) => Math.round(v * 1000) / 1000; // keep stored coords clean (3 dp)
      const next = points.map((p, k): Vec3 => (k === draggingIdx ? [r3(hit.x), r3(hit.y), r3(hit.z)] : (p as Vec3)));
      onPointsChange(next);
    }
  }
  function onUp() { if (draggingIdx >= 0) { draggingIdx = -1; hoverIdx = -1; if (orbit) orbit.enabled = true; } }

  // DOM-level move/up so the drag keeps tracking even when the cursor leaves the
  // sphere (interactivity() only fires while OVER a mesh).
  $effect(() => {
    const dom = renderer?.domElement;
    if (!dom) return;
    dom.addEventListener('pointerdown', onDown, true); // capture → beats OrbitControls
    dom.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });
</script>

<!-- Z-DOWN to match the main bake canvas (up = [0,0,-1]): X → right, Y → out of
     the screen, Z → down. Camera mostly on +Y (y toward viewer) with a slight
     +X/-Z tilt for depth. minPolarAngle 0 / maxPolarAngle π gives full up/down
     (around-X) rotation freedom. -->
<T.PerspectiveCamera makeDefault position={[2, 11, -3]} fov={45} up={[0, 0, -1]}>
  <OrbitControls bind:ref={orbit} enableDamping enabled={orbitEnabled} target={heldCenter}
    minPolarAngle={0} maxPolarAngle={Math.PI} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.8} />
<T.DirectionalLight position={[10, 15, 10]} intensity={1.1} />
<T.GridHelper args={[20, 20, 0xcccccc, 0xeeeeee]} />
<!-- XYZ axes — colored tubes + arrowheads (X red · Y green · Z blue). -->
{#each AXES as ax (ax.key)}
  <T.Mesh position={ax.pos} rotation={ax.rot}>
    <T.CylinderGeometry args={[0.035, 0.035, AXIS_LEN, 8]} />
    <T.MeshBasicMaterial color={ax.c} />
  </T.Mesh>
  <T.Mesh position={ax.tip} rotation={ax.rot}>
    <T.ConeGeometry args={[0.13, 0.4, 10]} />
    <T.MeshBasicMaterial color={ax.c} />
  </T.Mesh>
{/each}

<!-- PROJECTION of the curve onto the ground plane (y=0) — its flattened grey
     footprint, NOT a rendered shadow (a CAD-style projection for depth read). -->
{#if projObj}
  <T is={projObj} />
{/if}

<!-- the smooth Catmull-Rom curve (clickable tube → insert a point mid-run) -->
{#if curveObj}
  <T is={curveObj} onclick={onCurveClick} />
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
    onpointerenter={() => { if (interactive) hoverIdx = i; }}
    onpointerleave={() => { if (draggingIdx < 0) hoverIdx = -1; }}>
    <T.SphereGeometry args={[0.28, 16, 16]} />
    <T.MeshStandardMaterial
      color={i === selectedIdx ? 0xf59e0b : 0x7c3aed}
      emissive={i === draggingIdx ? 0xf59e0b : 0x000000}
      emissiveIntensity={0.5} />
  </T.Mesh>
{/each}
