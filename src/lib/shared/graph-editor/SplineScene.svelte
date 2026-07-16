<!--
  SplineScene.svelte — the Threlte 3D scene INSIDE SplineEditorPopup's <Canvas>
  (TODO #15, the spline-editor path card; Batch-3 overhaul).

  Renders, for a `spline` node's control points:
    • draggable spheres at each control point (a capture-phase pointerdown
      ray-casts onto a drag plane — OrbitControls is suspended while a handle is
      held). The spheres + sample dots are ZOOM-STABLE (constant screen size).
    • the centripetal Catmull-Rom curve through them (THREE.CatmullRomCurve3 —
      THREE is fine here, only the Manifold BAKE stays three-free; the bake
      recomputes the same curve with the pure-JS resampleSpline), and
    • small markers at the N equally-spaced ARC-LENGTH samples (resampleSpline).

  Batch-3 additions:
    • FLAT ORTHOGRAPHIC plane views (XY / YZ / XZ) — a plane view LOCKS the
      out-of-plane axis while dragging (spline-view.ts). The free 3D orbit stays.
    • the grid + axes are sized to the control-point bounding box.
    • the ＋point / −point buttons + option toggles live in the popup's DOM
      overlay (SplineEditorPopup) — a Threlte <HTML> overlay is anchored to the
      projected world-origin and DRIFTS as the camera orbits, so the toolbar is
      screen-fixed DOM instead. This scene just draws the 3D + reacts to `view`.

  NO `three/examples/jsm/*` / `three/addons/*` — Canvas + T + OrbitControls +
  interactivity from @threlte/* only (the repo convention).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { T, useThrelte, useTask } from '@threlte/core';
  import { OrbitControls, interactivity } from '@threlte/extras';
  import * as THREE from 'three';
  import { resampleSpline, type Vec3 } from '$lib/graph/spline-resample';
  import { planeAxes, applyPlaneLock, pointsBbox, gridFor, snapVec3, type SplineView } from '$lib/graph/spline-view';

  let {
    points,
    samples,
    closed = false,
    interactive = true,
    selectedIdx = $bindable(-1),
    view = $bindable<SplineView>('free'),
    snap = $bindable(false),
    onPointsChange,
  }: {
    points: Vec3[];
    samples: number;
    /** Loop the curve (last→first). Mirrors the spline node's `closed` flag. */
    closed?: boolean;
    /** When false, control points are READ-ONLY (wired expression, #26). */
    interactive?: boolean;
    /** Currently-selected control point (for remove + highlight). */
    selectedIdx?: number;
    /** Active editor view — free 3D orbit or a flat orthographic plane. The
     *  view BUTTONS live in the popup DOM overlay (screen-fixed); the scene just
     *  REACTS to `view` to (re)frame the orthographic plane camera. */
    view?: SplineView;
    /** Snap-to-grid drag aid (⊞). Owned by the popup toolbar; read here in the
     *  point-drag so dragged points round to the visible grid. */
    snap?: boolean;
    onPointsChange: (pts: Vec3[]) => void;
  } = $props();

  interactivity();
  const { camera, renderer, invalidate, size } = useThrelte();

  // ─── derived geometry ─────────────────────────────────────────────────────
  const vecs = $derived(points.filter((p) => Array.isArray(p) && p.length >= 3));

  /** BBox → grid sizing (item b) + axis lengths, recomputed as points move. */
  const gridConf = $derived.by(() => {
    const bb = pointsBbox(vecs);
    const pa = planeAxes(view);
    const span = pa
      ? Math.max(bb.max[pa.uAxis] - bb.min[pa.uAxis], bb.max[pa.vAxis] - bb.min[pa.vAxis])
      : Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]);
    const g = gridFor(span);
    if (!pa) return { size: g.size, div: g.divisions, pos: [bb.center[0], 0, bb.center[2]] as Vec3, rot: [0, 0, 0] as Vec3 };
    // Plane views — lie the grid in the view plane at the bbox centre.
    const rot: Vec3 = pa.lockAxis === 2 ? [Math.PI / 2, 0, 0] : pa.lockAxis === 0 ? [0, 0, Math.PI / 2] : [0, 0, 0];
    return { size: g.size, div: g.divisions, pos: [bb.center[0], bb.center[1], bb.center[2]] as Vec3, rot };
  });
  const axisLen = $derived(Math.max(4, pointsBbox(vecs).span * 0.6));

  // ─── snap-to-grid (⊞) — VIEW-only drag aid. Dragged control points round to the
  // visible grid cell (gridConf size ÷ divisions) so a path can be built on clean
  // coords. `snap` is a prop (owned by the popup toolbar). ────────
  const snapStep = $derived(gridConf.size / Math.max(1, gridConf.div));

  // XYZ axes — colored tubes + arrowheads (X red · Y green · Z blue).
  const AXES = $derived([
    { key: 'x', c: 0xef4444, pos: [axisLen / 2, 0, 0] as Vec3, tip: [axisLen, 0, 0] as Vec3, rot: [0, 0, -Math.PI / 2] as Vec3 },
    { key: 'y', c: 0x22c55e, pos: [0, axisLen / 2, 0] as Vec3, tip: [0, axisLen, 0] as Vec3, rot: [0, 0, 0] as Vec3 },
    { key: 'z', c: 0x3b82f6, pos: [0, 0, axisLen / 2] as Vec3, tip: [0, 0, axisLen] as Vec3, rot: [Math.PI / 2, 0, 0] as Vec3 },
  ]);

  /** The smooth curve as a thin TUBE mesh (raycasts for click-to-insert). */
  let curveObj = $state<THREE.Object3D | null>(null);
  $effect(() => {
    if (vecs.length < 2) { curveObj = null; invalidate(); return; }
    const cps = vecs.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(cps, closed, 'centripetal');
    const g = new THREE.TubeGeometry(curve, Math.max(16, vecs.length * 24), 0.06, 10, closed);
    const m = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.5 });
    curveObj = new THREE.Mesh(g, m);
    invalidate();
    return () => { g.dispose(); m.dispose(); };
  });

  /** Ground PROJECTION of the curve (control points flattened to y=0). */
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

  /** Click on the curve → insert a control point between the nearest chord. */
  function distToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
    return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
  }
  function onCurveClick(e: any) {
    if (!interactive) return;
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

  // ─── flat orthographic plane frame (item a) ───────────────────────────────
  // Computed ONCE per view switch (not per drag) from a bbox snapshot, so
  // dragging a point never re-frames / jumps the camera. args are frozen for the
  // view session (aspect snapshotted) → OrbitControls pan/zoom stay put.
  let planeFrame = $state<{
    args: [number, number, number, number, number, number];
    pos: Vec3; up: Vec3; center: Vec3; orthoBase: number;
  } | null>(null);

  // React to `view` (set by the popup toolbar buttons): (re)frame the plane
  // camera. Only `view` is a tracked dep — the bbox/size snapshot is read
  // UNTRACKED so dragging a point never re-frames / jumps the camera.
  $effect(() => {
    const v = view;
    if (v === 'free') { planeFrame = null; invalidate(); return; }
    untrack(() => {
      const pa = planeAxes(v)!;
      const bb = pointsBbox(vecs);
      const sz = $size;
      const aspect = sz && sz.height > 0 ? sz.width / sz.height : 1.4;
      const halfExt = Math.max(bb.span, 2) * 0.7;
      const halfH = aspect >= 1 ? halfExt : halfExt / aspect;
      const halfW = aspect >= 1 ? halfExt * aspect : halfExt;
      const dist = Math.max(bb.span * 4, 50);
      const pos: Vec3 = [bb.center[0], bb.center[1], bb.center[2]];
      pos[pa.lockAxis] = bb.center[pa.lockAxis] + dist;
      const up: Vec3 = [0, 0, 0];
      up[pa.vAxis] = 1;
      planeFrame = {
        args: [-halfW, halfW, halfH, -halfH, 0.01, dist * 4],
        pos, up, center: [bb.center[0], bb.center[1], bb.center[2]], orthoBase: halfH * 0.05,
      };
    });
    invalidate();
  });

  // ─── zoom-stable handle sizing (item c) ───────────────────────────────────
  // Keep control spheres + sample dots at a ~constant SCREEN size: for the
  // perspective (free) camera scale ∝ distance; for the orthographic plane
  // cameras scale ∝ 1/zoom. Updated each rendered frame (on-demand loop).
  let handleScale = $state(0.28);
  const scratchCenter = new THREE.Vector3();
  useTask(() => {
    const cam = camera.current as any;
    if (!cam) return;
    let s: number;
    if (cam.isOrthographicCamera) {
      const base = planeFrame ? planeFrame.orthoBase : 0.5;
      s = base / (cam.zoom || 1);
    } else {
      scratchCenter.set(heldCenter[0], heldCenter[1], heldCenter[2]);
      s = cam.position.distanceTo(scratchCenter) * 0.026;
    }
    s = Math.max(0.05, Math.min(6, s));
    if (Math.abs(s - handleScale) > handleScale * 0.02) handleScale = s;
  });
  const sampleScale = $derived(handleScale * 0.28);

  // ─── dragging a control point ─────────────────────────────────────────────
  let draggingIdx = $state(-1);
  let hoverIdx = $state(-1);
  const orbitEnabled = $derived(draggingIdx < 0 && hoverIdx < 0);
  let orbit = $state<any>(null);
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let dragLockAxis = -1;            // out-of-plane axis in a plane view (-1 = free)
  let dragOrig: Vec3 = [0, 0, 0];   // point at drag-start (locked coord source)

  // OrbitControls focus = centroid, FROZEN during a drag (else the view eases).
  let heldCenter = $state<[number, number, number]>([0, 0, 0]);
  $effect(() => {
    if (draggingIdx >= 0) return;
    const n = vecs.length;
    if (n === 0) { heldCenter = [0, 0, 0]; return; }
    const s = vecs.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    heldCenter = [s[0] / n, s[1] / n, s[2] / n];
  });

  function onDown(ev: PointerEvent) {
    if (!interactive) return;
    const dom = renderer?.domElement;
    if (!dom || vecs.length === 0) return;
    const rect = dom.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera.current);
    const hitR = Math.max(0.25, handleScale * 1.2); // match the zoom-stable visual radius
    let hitIdx = -1, hitAlong = Infinity;
    for (let i = 0; i < vecs.length; i++) {
      const c = new THREE.Vector3(vecs[i]![0], vecs[i]![1], vecs[i]![2]);
      if (ray.ray.distanceToPoint(c) <= hitR) {
        const along = ray.ray.origin.distanceToSquared(c);
        if (along < hitAlong) { hitAlong = along; hitIdx = i; }
      }
    }
    if (hitIdx < 0) return; // empty space → leave it for OrbitControls
    ev.stopImmediatePropagation();
    selectedIdx = hitIdx;
    draggingIdx = hitIdx;
    if (orbit) orbit.enabled = false;
    const p = vecs[hitIdx]!;
    const pa = planeAxes(view);
    if (pa) {
      // Plane view — lock the out-of-plane axis by dragging in the view plane.
      dragLockAxis = pa.lockAxis;
      dragOrig = [p[0], p[1], p[2]];
      const nrm: Vec3 = [0, 0, 0];
      nrm[pa.lockAxis] = 1;
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(nrm[0], nrm[1], nrm[2]), new THREE.Vector3(p[0], p[1], p[2]));
    } else {
      dragLockAxis = -1;
      camera.current.getWorldDirection(camDir);
      plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(p[0], p[1], p[2]));
    }
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
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      const hv: Vec3 = snap ? snapVec3([hit.x, hit.y, hit.z], snapStep) : [hit.x, hit.y, hit.z];
      const nextPt: Vec3 = dragLockAxis >= 0
        ? applyPlaneLock(dragOrig, hv, dragLockAxis as 0 | 1 | 2)
        : [r3(hv[0]), r3(hv[1]), r3(hv[2])];
      const next = points.map((p, k): Vec3 => (k === draggingIdx ? nextPt : (p as Vec3)));
      onPointsChange(next);
    }
  }
  function onUp() { if (draggingIdx >= 0) { draggingIdx = -1; hoverIdx = -1; dragLockAxis = -1; if (orbit) orbit.enabled = true; } }

  $effect(() => {
    const dom = renderer?.domElement;
    if (!dom) return;
    dom.addEventListener('pointerdown', onDown, true);
    dom.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });
</script>

<!-- Camera: free 3D perspective (Z-down, up=[0,0,-1]) OR a flat orthographic
     plane. minPolarAngle 0 / maxPolarAngle π gives full up/down orbit freedom. -->
{#if view === 'free'}
  <T.PerspectiveCamera makeDefault position={[2, 11, -3]} fov={45} up={[0, 0, -1]}>
    <OrbitControls bind:ref={orbit} enableDamping enabled={orbitEnabled} target={heldCenter}
      minPolarAngle={0} maxPolarAngle={Math.PI} />
  </T.PerspectiveCamera>
{:else if planeFrame}
  <T.OrthographicCamera makeDefault args={planeFrame.args} position={planeFrame.pos} up={planeFrame.up} zoom={1}>
    <OrbitControls bind:ref={orbit} enableDamping enableRotate={false} enabled={orbitEnabled} target={planeFrame.center} />
  </T.OrthographicCamera>
{/if}

<T.AmbientLight intensity={0.8} />
<T.DirectionalLight position={[10, 15, 10]} intensity={1.1} />
<T.GridHelper args={[gridConf.size, gridConf.div, 0xcccccc, 0xeeeeee]} position={gridConf.pos} rotation={gridConf.rot} />

<!-- XYZ axes — colored tubes + arrowheads (X red · Y green · Z blue). -->
{#each AXES as ax (ax.key)}
  <T.Mesh position={ax.pos} rotation={ax.rot}>
    <T.CylinderGeometry args={[0.035, 0.035, axisLen, 8]} />
    <T.MeshBasicMaterial color={ax.c} />
  </T.Mesh>
  <T.Mesh position={ax.tip} rotation={ax.rot}>
    <T.ConeGeometry args={[0.13, 0.4, 10]} />
    <T.MeshBasicMaterial color={ax.c} />
  </T.Mesh>
{/each}

<!-- PROJECTION of the curve onto the ground plane (y=0). -->
{#if projObj}
  <T is={projObj} />
{/if}

<!-- the smooth Catmull-Rom curve (clickable tube → insert a point mid-run) -->
{#if curveObj}
  <T is={curveObj} onclick={onCurveClick} />
{/if}

<!-- N equally-spaced arc-length samples (zoom-stable dots) -->
{#each sampledPts as sp, i (i)}
  <T.Mesh position={[sp[0], sp[1], sp[2]]} scale={sampleScale}>
    <T.SphereGeometry args={[1, 8, 8]} />
    <T.MeshBasicMaterial color={0x10b981} />
  </T.Mesh>
{/each}

<!-- draggable control points (zoom-stable spheres) -->
{#each vecs as p, i (i)}
  <T.Mesh
    position={[p[0], p[1], p[2]]}
    scale={handleScale}
    onpointerenter={() => { if (interactive) hoverIdx = i; }}
    onpointerleave={() => { if (draggingIdx < 0) hoverIdx = -1; }}>
    <T.SphereGeometry args={[1, 16, 16]} />
    <T.MeshStandardMaterial
      color={i === selectedIdx ? 0xf59e0b : 0x7c3aed}
      emissive={i === draggingIdx ? 0xf59e0b : 0x000000}
      emissiveIntensity={0.5} />
  </T.Mesh>
{/each}

<!-- The editor CONTROLS (views · ＋pt/−pt · snap · loop · plot · N) live in the
     popup's DOM overlay (SplineEditorPopup), NOT here: a Threlte <HTML> overlay
     is anchored to the projected world-origin and drifts as you orbit. -->

