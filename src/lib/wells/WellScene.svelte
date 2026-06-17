<!--
  WellScene.svelte — the 3D-first well (W1). Renders an AssembledWell: every
  casing/open-hole/cement/completion/perf placed along the trajectory by depth,
  z-DOWN (cadtrain convention: larger z = deeper, camera up = [0,0,-1] so the
  wellhead is at the top of the view). Geometry is PRIMITIVE for now (cylinders
  by OD) — W1.3 swaps completions for real baked g_* part meshes.

  Scene CONTENT only (lives inside a parent <Canvas>). Radial exaggeration makes
  thin strings visible against the depth extent.
-->
<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import * as THREE from 'three';
  import type { AssembledWell, WellPart } from './assemble';

  let { assembled, radialExag = 28 }: { assembled: AssembledWell; radialExag?: number } = $props();

  const IN_TO_M = 0.0254;
  const UP = new THREE.Vector3(0, 1, 0);

  // Per-part cylinder spec: midpoint position + quaternion (Y→segment dir) +
  // radius/height. Opacity: open hole + casing translucent so inner parts show.
  interface MeshSpec { position: [number, number, number]; quaternion: [number, number, number, number]; r: number; h: number; color: string; opacity: number; kind: string; }

  function specOf(p: WellPart): MeshSpec | null {
    const a = new THREE.Vector3(...p.pTop), b = new THREE.Vector3(...p.pBot);
    const dir = new THREE.Vector3().subVectors(b, a);
    const h = dir.length();
    if (h < 1e-6 && p.kind !== 'perf') return null;
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const r = Math.max(0.4, (p.odIn * IN_TO_M * radialExag) / 2);
    const opacity = p.kind === 'openhole' ? 0.12 : p.kind === 'cement' ? 0.25 : p.kind === 'casing' ? 0.45 : 0.95;
    return { position: [mid.x, mid.y, mid.z], quaternion: [q.x, q.y, q.z, q.w], r, h: Math.max(h, 0.5), color: p.color, opacity, kind: p.kind };
  }

  // Draw widest → narrowest so translucent casing/OH wrap the inner completions.
  const meshes = $derived(
    (assembled?.parts ?? [])
      .map((p) => ({ p, s: specOf(p) }))
      .filter((m) => m.s)
      .sort((x, y) => (y.s!.r - x.s!.r)) as { p: WellPart; s: MeshSpec }[]);

  // Perforation markers — small red discs astride the casing at perf depth.
  const perfs = $derived((assembled?.parts ?? []).filter((p) => p.kind === 'perf'));

  // Camera: side view, framing the full depth. Look at the well's mid-depth.
  const tvd = $derived(assembled?.tvdMax || 100);
  const center = $derived<[number, number, number]>([0, 0, tvd / 2]);
  const camPos = $derived<[number, number, number]>([tvd * 0.62, tvd * 0.18, tvd / 2]);
</script>

<T.PerspectiveCamera makeDefault position={camPos} fov={42} up={[0, 0, -1]}>
  <OrbitControls enableDamping target={center} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.7} />
<T.DirectionalLight position={[tvd, tvd * 0.5, -tvd * 0.4]} intensity={1.1} />
<T.DirectionalLight position={[-tvd * 0.6, -tvd * 0.3, tvd * 0.5]} intensity={0.5} />

<!-- Depth axis — wellhead (z=0) to TD, a thin guide line down the bore. -->
<T.Line>
  <T.BufferGeometry oncreate={(g) => g.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, tvd)])} />
  <T.LineBasicMaterial color="#3a3a52" />
</T.Line>

{#each meshes as { p, s } (p.kind + p.label + p.top)}
  <T.Mesh position={s.position} quaternion={s.quaternion}>
    <T.CylinderGeometry args={[s.r, s.r, s.h, 28, 1, true]} />
    <T.MeshStandardMaterial color={s.color} transparent={s.opacity < 1} opacity={s.opacity}
      side={s.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide} metalness={0.3} roughness={0.6} />
  </T.Mesh>
{/each}

{#each perfs as p (p.label + p.top)}
  {@const z = (p.pTop[2] + p.pBot[2]) / 2}
  <T.Mesh position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
    <T.TorusGeometry args={[Math.max(2.5, radialExag * 0.18), 0.8, 8, 20]} />
    <T.MeshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.4} />
  </T.Mesh>
{/each}
