/**
 * Component Builder — ManifoldCAD geometry for each primitive
 */

import * as THREE from 'three';
import { COMPONENTS } from './library';
// Manifold runtime + small helpers live in their own module so per-primitive
// component files can import them without depending on builder.ts. Re-exported
// here for back-compat with anything still importing them from this file.
import { M, cyl, tube, mv, rot, getCutBox, tagManifold } from './manifold-helpers';
import { SECTION_ID, triSourceIds } from './part-id';
import { warpVertex, type WarpSpec } from './warp-geom';
export { CIRCULAR_SEGMENTS_DEFAULT, CIRCULAR_SEGMENTS_COMPOSE, setCircularSegmentMode, initManifold } from './manifold-helpers';

/** Per-part color table (built server-side by analyzeParts). When present
 *  + active, the renderers color each triangle by its source part via the
 *  Manifold relation instead of the material/heuristic path.
 *  outer = external skin per part; inner = the part's cut-surface color;
 *  subtractive ids draw their faces with `inner`; SECTION_ID → bodyInner. */
export interface PartColorLUT {
  outer: Record<number, string>;
  inner: Record<number, string>;
  subtractive: number[];
  bodyId: number | null;
  bodyInner: string;
  bodyColor: string;
  active: boolean;
}

/** hashId → [r,g,b] floats, from a hex map. */
function rgbMap(hexById: Record<number, string>): Map<number, [number, number, number]> {
  const m = new Map<number, [number, number, number]>();
  for (const k of Object.keys(hexById)) m.set(Number(k), hexToRgb(hexById[Number(k)]));
  return m;
}

// ═══ BUILDERS ═══
//
// Hand-written builders for legacy primitives. Single-file components
// (`meta` + `geom` modules in ./components/) are dispatched
// through the COMPONENT_REGISTRY consult inside buildPrimitiveManifold below
// — they are NOT mirrored here. Adding a new component file makes it
// renderable automatically; no entry in this map needed.

export const builders: Record<string, (p: Record<string, number>) => any> = {

  threaded_box(p) {
    // Optional 1:N taper on the bore (API SC/LC/BC = 1:16 ≈ 0.0625, where
    // the bore widens by `taper` units of radius per unit of length toward
    // z=length). taper=0 → straight cylinder + constant-radius grooves
    // (legacy behavior, no regression for callers that don't pass it).
    const taper = p.taper ?? 0;
    const idBase = p.od - 2 * p.wall;
    const rStart = idBase / 2;                  // small end (deep inside coupling)
    const rEnd = idBase / 2 + taper * p.length; // mouth (widest)
    // Constant OD shell with tapered bore subtracted.
    let body = cyl(p.length, p.od / 2, p.od / 2);
    body = body.subtract(mv(cyl(p.length + 0.02, rStart, rEnd), [0, 0, -0.01]));
    // Threads follow the bore — radius interpolates with z so the cut
    // depth is constant relative to the local bore wall.
    for (let i = 0; i < p.threadCount; i++) {
      const t = (i + 0.5) / p.threadCount;
      const tz = p.length * t;
      const localR = rStart + (rEnd - rStart) * t;
      body = body.subtract(mv(tube(localR + p.threadDepth, localR - 0.01, 0.05), [0, 0, tz]));
    }
    return body;
  },

  threaded_pin(p) {
    // Optional 1:N taper on the OD (API SC/LC/BC = 1:16 ≈ 0.0625, where
    // the OD shrinks by `taper` units of radius per unit length toward
    // z=length, so the pin nose is the smallest cross-section). taper=0
    // → straight cylinder + constant-radius grooves (legacy behavior).
    const taper = p.taper ?? 0;
    const id = p.od - 2 * p.wall;
    const rStart = p.od / 2;                    // full body OD at z=0
    const rEnd = p.od / 2 - taper * p.length;   // narrow tip at z=length
    // Tapered OD with straight bore subtracted.
    let body = cyl(p.length, rStart, rEnd);
    body = body.subtract(mv(cyl(p.length + 0.02, id / 2, id / 2), [0, 0, -0.01]));
    for (let i = 0; i < p.threadCount; i++) {
      const t = (i + 0.5) / p.threadCount;
      const tz = p.length * t;
      const localR = rStart - taper * p.length * t;
      body = body.subtract(mv(tube(localR + 0.01, localR - p.threadDepth, 0.04), [0, 0, tz]));
    }
    return body;
  },

  // ── Collared pin: anatomical male end ────────────────────────────────────
  // Same body-stub → taper → collar anatomy with threads cut into the OD.
  threaded_pin_collared(p) {
    const od = p.od;
    const collarOD = p.collarOD;
    const stubLen = p.bodyStubLength;
    const taperLen = p.taperHeight;
    const collarLen = p.collarLength;
    const id = od - 2 * p.wall;

    let body = M.cube([0.001, 0.001, 0.001], true);
    if (stubLen > 0) {
      body = body.add(mv(cyl(stubLen, od / 2), [0, 0, stubLen / 2]));
    }
    if (taperLen > 0) {
      body = body.add(mv(cyl(taperLen, od / 2, collarOD / 2), [0, 0, stubLen + taperLen / 2]));
    }

    // Collar OD — optional 1:N thread taper shrinks the OD toward the tip.
    const taper = p.taper ?? 0;
    const collarStartZ = stubLen + taperLen;
    const odStart = collarOD / 2;
    const odEnd = collarOD / 2 - taper * collarLen;
    body = body.add(mv(cyl(collarLen, odStart, odEnd), [0, 0, collarStartZ + collarLen / 2]));

    // Single straight bore through the entire part.
    body = body.subtract(mv(cyl(stubLen + taperLen + collarLen + 0.02, id / 2), [0, 0, (stubLen + taperLen + collarLen + 0.02) / 2 - 0.01]));

    // Threads cut into the collar OD.
    for (let i = 0; i < p.threadCount; i++) {
      const t = (i + 0.5) / p.threadCount;
      const tz = collarStartZ + collarLen * t;
      const localR = odStart - taper * collarLen * t;
      body = body.subtract(mv(tube(localR + 0.01, localR - p.threadDepth, 0.04), [0, 0, tz]));
    }
    return body;
  },

  thread_if(p) {
    // IF: flush bore — same ID through body and pin
    const id = p.bodyOD - 2 * p.wall;
    let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
    let pin = tube(p.pinOD / 2, id / 2, p.pinLength);
    pin = mv(pin, [0, 0, p.bodyLength]);
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.bodyLength + p.pinLength * (i + 0.5) / p.threadCount;
      pin = pin.subtract(mv(tube(p.pinOD / 2 + 0.01, p.pinOD / 2 - p.threadDepth, 0.03), [0, 0, tz]));
    }
    return body.add(pin);
  },

  thread_fh(p) {
    // FH: body → shoulder → pin, larger bore
    const id = p.bodyOD - 2 * p.wall;
    let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
    body = body.add(mv(cyl(p.shoulderWidth, p.bodyOD / 2), [0, 0, p.bodyLength]));
    body = body.subtract(cyl(p.bodyLength + p.shoulderWidth + 0.1, id / 2));
    let pin = tube(p.pinOD / 2, id / 2, p.pinLength);
    pin = mv(pin, [0, 0, p.bodyLength + p.shoulderWidth]);
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.bodyLength + p.shoulderWidth + p.pinLength * (i + 0.5) / p.threadCount;
      pin = pin.subtract(mv(tube(p.pinOD / 2 + 0.01, p.pinOD / 2 - p.threadDepth, 0.04), [0, 0, tz]));
    }
    return body.add(pin);
  },

  thread_nc(p) {
    // NC: heavy duty, wide shoulder, thick wall
    const id = p.bodyOD - 2 * p.wall;
    let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
    body = body.add(mv(cyl(p.shoulderWidth, p.bodyOD / 2), [0, 0, p.bodyLength]));
    body = body.subtract(cyl(p.bodyLength + p.shoulderWidth + 0.1, id / 2));
    let pin = tube(p.pinOD / 2, id / 2, p.pinLength);
    pin = mv(pin, [0, 0, p.bodyLength + p.shoulderWidth]);
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.bodyLength + p.shoulderWidth + p.pinLength * (i + 0.5) / p.threadCount;
      pin = pin.subtract(mv(tube(p.pinOD / 2 + 0.01, p.pinOD / 2 - p.threadDepth, 0.05), [0, 0, tz]));
    }
    return body.add(pin);
  },

  thread_eue(p) {
    // EUE: body → taper → upset → threads
    const id = p.bodyOD - 2 * p.wall;
    let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
    // Taper from body to upset
    const taper = cyl(p.taperH, p.bodyOD / 2, p.upsetOD / 2).subtract(
      cyl(p.taperH + 0.02, id / 2, id / 2));
    body = body.add(mv(taper, [0, 0, p.bodyLength]));
    // Upset section with threads
    let upset = tube(p.upsetOD / 2, id / 2, p.upsetLength);
    upset = mv(upset, [0, 0, p.bodyLength + p.taperH]);
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.bodyLength + p.taperH + p.upsetLength * (i + 0.5) / p.threadCount;
      upset = upset.subtract(mv(tube(p.upsetOD / 2 + 0.01, p.upsetOD / 2 - p.threadDepth, 0.04), [0, 0, tz]));
    }
    return body.add(upset);
  },

  thread_ltc(p) {
    // LTC: pipe with external threads + coupling
    const id = p.od - 2 * p.wall;
    let pipe = tube(p.od / 2, id / 2, p.length);
    // Threads on end
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.length * (i + 0.5) / p.threadCount;
      pipe = pipe.subtract(mv(tube(p.od / 2 + 0.01, p.od / 2 - p.threadDepth, 0.03), [0, 0, tz]));
    }
    // Coupling (larger OD ring)
    const coupling = tube(p.couplingOD / 2, p.od / 2 - p.threadDepth, p.couplingLength);
    pipe = pipe.add(mv(coupling, [0, 0, p.length / 2 - p.couplingLength / 2]));
    return pipe;
  },

  taper(p) {
    const idTop = p.odTop - 2 * p.wall;
    const idBottom = p.odBottom - 2 * p.wall;
    const outer = cyl(p.length, p.odTop / 2, p.odBottom / 2);
    const inner = cyl(p.length + 0.02, idTop / 2, idBottom / 2);
    return outer.subtract(mv(inner, [0, 0, -0.01]));
  },

  shoulder(p) {
    const idSmall = p.odSmall - 2 * p.wall;
    const idLarge = p.odLarge - 2 * p.wall;
    let body = tube(p.odSmall / 2, idSmall / 2, p.smallLength);
    // Taper transition
    if (p.taperH > 0.01) {
      body = body.add(mv(cyl(p.taperH, p.odSmall / 2, p.odLarge / 2).subtract(
        cyl(p.taperH + 0.02, idSmall / 2, idLarge / 2)
      ), [0, 0, p.smallLength]));
      body = body.add(mv(tube(p.odLarge / 2, idLarge / 2, p.largeLength), [0, 0, p.smallLength + p.taperH]));
    } else {
      body = body.add(mv(tube(p.odLarge / 2, idLarge / 2, p.largeLength), [0, 0, p.smallLength]));
    }
    return body;
  },

  slotted_cylinder(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    // Longitudinal slots
    for (let i = 0; i < p.numSlots; i++) {
      const angle = i * (360 / p.numSlots);
      let slot = M.cube([p.slotWidth, p.slotDepth, p.length * 0.8], true);
      slot = slot.translate([0, p.od / 2 - p.slotDepth / 2, p.length / 2]);
      slot = slot.rotate([0, 0, angle]);
      body = body.subtract(slot);
    }
    return body;
  },

  seal_bore(p) {
    let body = tube(p.od / 2, p.boreID / 2, p.length);
    // Internal seal grooves
    for (let i = 0; i < p.numGrooves; i++) {
      const gz = p.length * (i + 1) / (p.numGrooves + 1);
      body = body.subtract(mv(tube(p.boreID / 2 + p.grooveDepth, p.boreID / 2 - 0.01, p.grooveWidth), [0, 0, gz - p.grooveWidth / 2]));
    }
    return body;
  },

  grooved_cylinder(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    for (let i = 0; i < p.numGrooves; i++) {
      const gz = p.length * (i + 1) / (p.numGrooves + 1);
      body = body.subtract(mv(tube(p.od / 2 + 0.01, p.od / 2 - p.grooveDepth, 0.06), [0, 0, gz]));
    }
    return body;
  },

  slips(p) {
    const slipR = p.slipOD / 2;
    const bodyR = p.bodyOD / 2;
    let ring = tube(slipR, bodyR, p.height);

    // Smooth band at bottom
    const bandH = p.height * p.smoothBand;
    if (bandH > 0.01) {
      const bandR = slipR - p.grooveDepth * 1.5;
      ring = ring.subtract(tube(slipR + 0.01, bandR, bandH + 0.01));
    }

    // Sector gaps
    for (let i = 0; i < p.numSectors; i++) {
      const gap = mv(rot(M.cube([p.slipOD + 1, p.gapWidth, p.height + 1], true), [0, 0, i * (360 / p.numSectors)]), [0, 0, p.height / 2]);
      ring = ring.subtract(gap);
    }

    // Grooves (above smooth band)
    const groovedH = p.height - bandH;
    const grooveH = groovedH / p.numGrooves;
    for (let i = 0; i < p.numGrooves; i++) {
      const gz = bandH + grooveH * i;
      const cutOuter = cyl(grooveH * 0.85, slipR + 0.5, slipR + 0.5);
      const keep = cyl(grooveH * 0.85 + 0.01, slipR, slipR - p.grooveDepth);
      ring = ring.subtract(mv(cutOuter.subtract(keep), [0, 0, gz + grooveH * 0.05]));
    }
    return ring;
  },

  j_latch(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    // J-shaped slots cut into the OD
    for (let i = 0; i < p.numSlots; i++) {
      const angle = i * (360 / p.numSlots);
      // Vertical part of J
      let vSlot = M.cube([p.slotWidth, p.slotDepth, p.length * 0.6], true);
      vSlot = vSlot.translate([0, p.od / 2 - p.slotDepth / 2, p.length * 0.4]);
      vSlot = vSlot.rotate([0, 0, angle]);
      body = body.subtract(vSlot);
      // Horizontal part of J (bottom hook)
      let hSlot = M.cube([p.slotWidth * 2, p.slotDepth, p.slotWidth], true);
      hSlot = hSlot.translate([p.slotWidth * 0.5, p.od / 2 - p.slotDepth / 2, p.length * 0.1]);
      hSlot = hSlot.rotate([0, 0, angle]);
      body = body.subtract(hSlot);
    }
    return body;
  },

  // Multilateral pre-milled window — casing joint with a rectangular
  // window cut into the OD wall. Inspired by Halliburton's LatchRite
  // Pre-Milled Window system in the multilateral catalog: a window joint
  // sits at the planned lateral exit; the window is opened during junction
  // construction. params: od/wall/length define the body; windowWidth (in
  // OD-circumference fraction), windowHeight, windowOffset locate + size
  // the rectangular cutout.
  window_cutout(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    // Cutout is a thin rectangular slab oriented along the body axis with
    // its long edge in z and shorter edge in x. The width param is the
    // chord length of the window (in OD units); we centre it on the +Y face.
    const wH = p.windowHeight;
    const wW = p.windowWidth;
    const wZ = p.windowOffset;
    const cut = M.cube([wW, p.od * 1.2, wH], true);
    body = body.subtract(mv(cut, [0, 0, wZ + wH / 2]));
    return body;
  },

  // Whipstock — angled wedge that deflects a milling/drilling bit into a
  // lateral wellbore. Modeled as a half-cylinder with an inclined top face
  // (ramp). Used at multilateral junctions to kick off into lateral.
  // params: od/length/rampHeight/rampOffset.
  whipstock(p) {
    // Start with a solid cylinder body the full length.
    let body = cyl(p.length, p.od / 2);
    // Subtract a tilted cuboid to carve the ramp. The cuboid sits on the
    // +X side and rotates about the Y axis by rampAngle (atan(rampHeight/length)).
    const rampAngle = (Math.atan2(p.rampHeight, p.length) * 180) / Math.PI;
    const ramp = M.cube([p.od * 1.5, p.od * 1.5, p.length * 1.5], true);
    let tilted = rot(ramp, [0, -rampAngle, 0]);
    tilted = mv(tilted, [p.od * 0.6, 0, p.length / 2 + p.rampOffset]);
    body = body.subtract(tilted);
    return body;
  },

  // Sliding-sleeve valve mandrel — hollow body with N axial ports cut
  // through the wall + a polished seal bore at each end. Generic for
  // intelligent-completion ICV-style devices (HS-ICV, MCC-ICV in the
  // Halliburton catalog) without the trim choking detail.
  sliding_sleeve(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    // Ports are radial slots near the middle.
    const portZ = p.length / 2;
    for (let i = 0; i < p.numPorts; i++) {
      const angle = (i * 360) / p.numPorts;
      const port = rot(M.cube([p.od * 1.2, p.portWidth, p.portHeight], true), [0, 0, angle]);
      body = body.subtract(mv(port, [0, 0, portZ]));
    }
    // Seal bore bands cut as shallow grooves at each end (polished seal
    // bore receptacles for the production-string seal stack).
    const sbH = p.sealBoreHeight;
    body = body.subtract(mv(tube(id / 2 + p.sealBoreDepth, id / 2 - 0.01, sbH), [0, 0, sbH / 2]));
    body = body.subtract(mv(tube(id / 2 + p.sealBoreDepth, id / 2 - 0.01, sbH), [0, 0, p.length - sbH * 1.5]));
    return body;
  },

  // Drill-pipe tool joint — the upset OD section at one end of a drill
  // pipe joint. Carries grade-identification markings: numGrooves
  // circumferential grooves + numSlots short axial slots cut into the
  // tong-area band. Per the API drill-pipe identification chart.
  // Geometry: a hollow upset cylinder (toolJointOD > pipeOD); tong-area
  // band is a fraction of the length where the marks live.
  drill_pipe_tool_joint(p) {
    const id = p.toolJointOD - 2 * p.wall;
    let body = tube(p.toolJointOD / 2, id / 2, p.length);
    // Tong-area band sits in the middle third of the joint length.
    const bandStart = p.length * 0.35;
    const bandEnd = p.length * 0.65;
    const bandSpan = bandEnd - bandStart;
    // Circumferential grooves — full-OD bands, depth = grooveDepth.
    if (p.numGrooves > 0) {
      const stepZ = bandSpan / (p.numGrooves + 1);
      for (let i = 0; i < p.numGrooves; i++) {
        const gz = bandStart + stepZ * (i + 1);
        const gw = p.grooveWide ? p.grooveWidth * 2 : p.grooveWidth;
        body = body.subtract(mv(tube(p.toolJointOD / 2 + 0.01, p.toolJointOD / 2 - p.grooveDepth, gw), [0, 0, gz - gw / 2]));
      }
    }
    // Axial slots — short rectangular cuts oriented along the body axis,
    // cut on the +Y face (visible from the front). One per numSlots, spaced
    // around the band.
    for (let i = 0; i < p.numSlots; i++) {
      const sz = bandStart + bandSpan * (i + 0.5) / p.numSlots;
      const slot = M.cube([p.slotWidth, p.toolJointOD * 1.2, p.slotLength], true);
      body = body.subtract(mv(slot, [0, 0, sz]));
    }
    return body;
  },

  packer_element(p) {
    // Stack of rings representing rubber elements
    let element = M.cube([0.001, 0.001, 0.001], true);
    const ringH = p.length / p.numRings;
    for (let i = 0; i < p.numRings; i++) {
      const t = (i + 0.5) / p.numRings;
      // Barrel shape — wider in middle
      const midOD = p.odCompressed + (p.odExpanded - p.odCompressed) * Math.sin(t * Math.PI) * 0.3;
      const ring = tube(midOD / 2, p.mandrelOD / 2, ringH * 0.9);
      element = element.add(mv(ring, [0, 0, i * ringH]));
    }
    return element;
  },
};

// ═══ BUILD + CONVERT ═══

export interface ComponentResult {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  manifold: any;
  /** True when finalize auto-skipped the cutaway CSG step (manifold too
   *  large, > 120k tris — a genuinely huge SINGLE connected body where the
   *  per-body decompose-and-cut win can't apply). cutVC will be an empty
   *  BufferGeometry in that case. The bake panel can surface a "cutaway
   *  disabled" hint. */
  cutawaySkipped?: boolean;
  /** GPU-instancing payload — present ONLY when `opts.instanced` was set AND
   *  finalize detected N≥2 identical-up-to-translation bodies (a Stack/Repeat
   *  of the same child). When present, `full`/`cutVC` carry the CANONICAL CHILD
   *  mesh ONCE (not the merged N copies), and `instances` is the list of N
   *  rigid 4×4 transforms (column-major 16-float, THREE.Matrix4 order) placing
   *  each copy. The renderer draws a single THREE.InstancedMesh. Absent on the
   *  merged path → callers render `full`/`cutVC` as a single mesh, unchanged. */
  instances?: number[][];
}

/** Appearance pair carried on a primitive's `meta.material`. Mirrors
 *  `PrimMaterial` in src/lib/server/primitives-meta.ts — duplicated here
 *  to keep builder.ts free of a server-only import (it runs client-side
 *  too). Only `color` is consumed by the live-mesh path; metallic /
 *  roughness are GLB-only and ignored here. */
export interface RenderMaterialSpec { color: string; metallic?: number; roughness?: number }
export interface RenderMaterial { outer: RenderMaterialSpec; inner: RenderMaterialSpec }

/** '#rrggbb' (or bare 'rrggbb') → [r, g, b] floats in 0..1. Mirrors
 *  `hexToRgba` in manifold-bake.ts (drops alpha). Falls back to the
 *  legacy red on a malformed string so a typo can't blank a face. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return [0.8, 0.06, 0.06];
  const v = m[1];
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}

/**
 * Build a raw primitive manifold from the library, without any centering
 * or cutaway processing. Used by the composition interpreter
 * (src/lib/authoring/compose.ts) which needs to apply its own transforms
 * before finalizing. If you want a ready-to-render geometry, use
 * `buildComponent` instead.
 */
export function buildPrimitiveManifold(componentId: string, params: Record<string, number>): any {
  // Legacy ComponentDef builders (cad/library) + parent-chain fallback. The
  // runes bundle registry (src/lib/cad/components/) was removed with the
  // components product (2026-05-27); live /primitives bakes server-side via
  // primitive-loader (buildPrimitiveGeom), not this path.
  let fn = builders[componentId];
  // Walk the parent chain — derived primitives (ComponentDef.parent) reuse
  // their base class's builder unless they register their own. Lets us spin
  // up new spec-variants (box_stc, pin_ltc, …) by just adding a library
  // entry, no builder code required.
  if (!fn) {
    let cur = COMPONENTS.find((c) => c.id === componentId);
    while (cur?.parent && !fn) {
      fn = builders[cur.parent];
      cur = COMPONENTS.find((c) => c.id === cur!.parent);
    }
  }
  if (!fn) throw new Error(`Unknown component: ${componentId}`);
  return fn(params);
}

/**
 * Render-time Z-scale multiplier. Downhole tools are typically modelled
 * with lengths in feet or metres while OD/wall are in inches — at 1:1
 * scale a 30 ft joint with a 2 in OD renders as a thin string. The
 * multiplier compresses the Z axis at finalize time so proportions are
 * still recognisable in the viewport. The geom function's logical Z
 * values are unchanged; only the rendered geometry is squashed.
 *
 * Settable via `setRenderZScale` from the page-level UI slider. Read
 * at every `finalizeManifold` invocation, so changing it rebuilds the
 * scene for every active primitive in lock-step. Default is 1.0 (no
 * compression).
 */
let _renderZScale = 1.0;
export function setRenderZScale(v: number): void { _renderZScale = v; }
export function getRenderZScale(): number { return _renderZScale; }

/**
 * Apply the Y-axis half cutaway and convert to `full` + `cutVC` three.js
 * geometries. Shared between `buildComponent` and the composition
 * interpreter so both produce identical render output.
 *
 * No-op on positioning — the manifold is rendered exactly where the
 * geom function places it. The legacy Z-centering step was removed
 * (2026-05-13) because (a) it surprised users by silently undoing
 * deliberate `translate(_, _, z)` calls, and (b) for multi-part
 * assemblies it didn't actually help (gaps between parts were
 * preserved; only the assembly midpoint moved). Callers that want
 * a centered render now translate explicitly inside their geom.
 *
 * The render-time Z-scale (see `setRenderZScale`) is applied last, so
 * the cutaway box and the maxOD-keyed classification work in the
 * geom's natural units.
 */
/** Default outer/inner viewer hexes — the historical red/grey convention
 *  (docs: src/lib/cad/CLAUDE.md "Vertex colours classify faces"). Used only
 *  to fill the OTHER side when the caller supplies just one of the two
 *  per-part colour overrides. When NEITHER is supplied the override is
 *  undefined and the legacy heuristic runs byte-identically. */
export const DEFAULT_OUTER_HEX = '#cc2222';
export const DEFAULT_INNER_HEX = '#888888';

/** Per-part colour override (outside ← outer, inside ← bore/cut/internal),
 *  threaded from the preview request body. Replaces the hardcoded red/grey
 *  in the legacy classification WITHOUT changing the classification itself. */
export interface ColorOverride { outer: string; inner: string }

/** Bake the sinusoidal warp INTO the Manifold (returns a new warped Manifold).
 *  Absent spec → the original manifold, untouched (byte-identical bake). The
 *  callback receives each vertex as a Vec3 tuple `[x, y, z]` (manifold-3d
 *  3.4.1) and mutates it in place via the shared `warpVertex` math — the SAME
 *  `amp·sin(z·freq)` the old render-time shader used, so the geometry AND its
 *  EdgesGeometry now both follow the bulge (the shader couldn't bend edges). */
function applyWarp(m: any, w?: WarpSpec): any {
  if (!w) return m;
  try {
    return m.warp((v: [number, number, number]) => warpVertex(v, w.amp, w.freq, w.axis));
  } catch {
    // warp unsupported on this Manifold build → leave geometry un-warped.
    return m;
  }
}

/** Crease (minSharpAngle) for Manifold.calculateNormals: edges whose dihedral
 *  exceeds this stay HARD (split vertices); below it shade smooth. Hardcoded 60°
 *  historically; now a per-bake dial threaded through finalizeManifold opts.
 *  Clamp to a sane range so a stray value can't break the WASM call; undefined →
 *  60 → byte-identical to the legacy bake (and the legacy cache key). */
const DEFAULT_CREASE_ANGLE = 60;
function clampCrease(a?: number): number {
  if (typeof a !== 'number' || !Number.isFinite(a)) return DEFAULT_CREASE_ANGLE;
  return Math.max(1, Math.min(180, a));
}

export function finalizeManifold(manifold: any, maxOD: number, material?: RenderMaterial, parts?: PartColorLUT, opts?: { skipCutaway?: boolean | 'auto'; zScale?: number; colorOuter?: string; colorInner?: string; instanced?: boolean; warp?: WarpSpec; creaseAngle?: number }): ComponentResult {
  // Reject an EMPTY result — a CSG op (subtract/intersect) that removed all
  // geometry, e.g. subtracting two identically-dimensioned solids. Left
  // unguarded it serialises as a successful 0-triangle mesh; the client then
  // renders "blank" and its auto-fit/re-eval churns, which previously drove a
  // request-flood loop (2026-06-13). Fail loudly + once instead.
  try {
    const tris = typeof manifold?.numTri === 'function' ? manifold.numTri()
      : typeof manifold?.numTri === 'number' ? manifold.numTri : -1;
    if (tris === 0) {
      throw new Error('Bake produced an EMPTY solid — a CSG op (subtract/intersect) removed all geometry. Check the dimensions (e.g. the same OD on both sides of a subtract).');
    }
  } catch (e: any) {
    // Only re-throw OUR empty-solid error; a missing numTri must not break the bake.
    if (/EMPTY solid/.test(String(e?.message))) throw e;
  }
  // Z-scale is REQUEST-LOCAL via opts.zScale (falls back to the module global
  // for legacy callers). Threading it through avoids the concurrency race where
  // two simultaneous preview requests clobbered the shared _renderZScale before
  // either finalized (GRAPH_EDITOR_REVIEW / robustness-plan 1d).
  const z = opts?.zScale ?? _renderZScale;
  const scaled = z === 1.0 ? manifold : manifold.scale([1, 1, z]);
  const lut = parts?.active ? parts : undefined;
  // Tag the cut-box with SECTION_ID so the new cross-section faces it
  // creates are distinguishable (→ inner/section color) from the part
  // surfaces it reveals. Only matters on the color-by-source path.
  const _cutBB = scaled.boundingBox();
  const cutBox = lut ? tagManifold(getCutBox(_cutBB), SECTION_ID) : getCutBox(_cutBB);
  // Per-part colour override — present only when the caller passed at least
  // one of colorOuter/colorInner. Fills the unset side with the historical
  // default so a one-sided pick still renders the other side sanely. When
  // BOTH are absent → undefined → byte-identical legacy red/grey output.
  const override: ColorOverride | undefined = (opts?.colorOuter || opts?.colorInner)
    ? { outer: opts?.colorOuter ?? DEFAULT_OUTER_HEX, inner: opts?.colorInner ?? DEFAULT_INNER_HEX }
    : undefined;
  // ─── GPU instancing (opt-in) ────────────────────────────────────────────
  // When the caller asks (LIVE-mesh path only) AND the composed result is a
  // Stack/Repeat of N identical bodies, return the canonical child mesh ONCE
  // + N transforms instead of the merged N-copy mesh — O(1)+N transfer/render
  // instead of O(N·tris). Falls through to the merged path (below, BYTE-
  // IDENTICAL) when bodies are not all identical / there's only one body.
  // Crease angle for calculateNormals — build-time, baked into the vertex
  // split, so it MUST be applied here (not a render-time flip). Default 60.
  const crease = clampCrease(opts?.creaseAngle);
  if (opts?.instanced) {
    const inst = tryInstanceFinalize(scaled, cutBox, maxOD, material, lut, override, opts?.skipCutaway, opts?.warp, crease);
    if (inst) return inst;
  }
  // Auto-skip the cutaway only as a far-out safety valve. The cutVC step used
  // to do ONE pass (subtract + calculateNormals + getMesh) over the WHOLE
  // composed manifold; calculateNormals scales super-linearly (30k→204ms,
  // 100k→3776ms), forcing a 15k-tri skip → long stacks / big assemblies showed
  // NO cross-section ("cutaway off (perf)"). `cutawayVC` now decomposes into
  // bodies and cuts each (small) body, distributing that ~linearly, so a normal
  // long string (g_dp_stand ~47k tris) computes its cutaway by default. The
  // threshold is raised 15k → 120k so only a genuinely huge SINGLE connected
  // body (where the per-body win can't apply) still skips. `opts.skipCutaway
  // ===false` still force-computes regardless; ===true still force-skips.
  const skipCutaway = opts?.skipCutaway === true ? true
    : opts?.skipCutaway === false ? false
    : (typeof scaled.numTri === 'function' ? scaled.numTri() > 120_000 : false);
  // Bake the warp into the geometry LAST (after z-scale, before meshing). The
  // tri count is unchanged by warp, so the skip threshold above is judged on
  // `scaled`; we mesh + cut the warped result so both the surface mesh and the
  // cross-section follow the bend. `opts.warp` absent → `warped === scaled` →
  // byte-identical to the pre-warp bake.
  const warped = applyWarp(scaled, opts?.warp);
  return {
    full: manifoldToGeo(warped, material, lut, override, crease),
    cutVC: skipCutaway ? new THREE.BufferGeometry() : cutawayVC(warped, cutBox, maxOD, material, lut, override, crease),
    manifold: warped,
    cutawaySkipped: skipCutaway,
  } as ComponentResult & { cutawaySkipped: boolean };
}

/**
 * Detect a Stack/Repeat of N IDENTICAL bodies and, if found, return the
 * instancing payload (canonical child mesh ONCE + N rigid transforms).
 * Returns null when instancing does NOT apply (single body / mixed
 * composition / decompose unavailable) so the caller falls back to the
 * merged path BYTE-IDENTICALLY.
 *
 * Detection (the design's "decompose + group"):
 *   1. `scaled.decompose()` → the connected-component bodies. A Stack of
 *      separate joints yields N bodies; a single connected part yields 1.
 *   2. Each body gets a signature = numTri | numVert | bbox extents | volume
 *      (all translation-INVARIANT — a rigid Z-shift via mv() preserves every
 *      one). If ALL bodies share body[0]'s signature → they're identical up
 *      to a rigid transform → instance them. Any mismatch → null (fall back).
 *   3. The transform for each body is the translation of its bbox centre vs
 *      body[0]'s (body[0] itself = identity). Stacks differ only by Δz, so
 *      this recovers each copy's `mv([0,0,Δz])` offset.
 *
 * Correctness notes (cited in the task brief):
 *  - COLOURS: the canonical child is run through the SAME manifoldToGeo /
 *    manifoldToCutVC as the merged path (incl. the color-by-source relation
 *    when `lut` is active, and the red/grey or override classification), so
 *    the child carries the correct per-vertex colours; they replicate across
 *    every instance for free.
 *  - CUTAWAY: we cut the CANONICAL child against the same Y=0 cut-box and
 *    replicate it. Because the instance transforms are pure translations and
 *    a Z-stack keeps every copy on the same side of the Y=0 plane, cutting
 *    one child + translating == cutting the whole assembly. (Per-instance CSG
 *    is unnecessary.) cutaway skip is re-evaluated against the CHILD's tri
 *    count (small) rather than the merged total, so a long stack still gets
 *    its slice.
 *  - Z-OFFSET (graded-delta _stackRef): each copy's Δz is encoded in its
 *    matrix, so stack offsets carry through verbatim.
 */
function tryInstanceFinalize(
  scaled: any,
  cutBox: any,
  maxOD: number,
  material: RenderMaterial | undefined,
  lut: PartColorLUT | undefined,
  override: ColorOverride | undefined,
  skipCutawayOpt: boolean | 'auto' | undefined,
  warp: WarpSpec | undefined,
  crease: number,
): ComponentResult | null {
  let bodies: any[];
  try {
    if (typeof scaled.decompose !== 'function') return null;
    bodies = scaled.decompose();
  } catch {
    return null;
  }
  // Need ≥2 bodies for instancing to be a win. A single (connected) part →
  // null → merged path (== current single-part behaviour, byte-identical).
  if (!Array.isArray(bodies) || bodies.length < 2) return null;

  // Translation-invariant signature. numTri/numVert/volume are exact for a
  // rigid translation; bbox EXTENTS (max-min) are too (only the centre moves).
  const r6 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : 'x');
  const sigOf = (m: any): { sig: string; cx: number; cy: number; cz: number } => {
    const bb = m.boundingBox();
    const ex = bb.max[0] - bb.min[0], ey = bb.max[1] - bb.min[1], ez = bb.max[2] - bb.min[2];
    const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2, cz = (bb.min[2] + bb.max[2]) / 2;
    const nt = typeof m.numTri === 'function' ? m.numTri() : -1;
    const nv = typeof m.numVert === 'function' ? m.numVert() : -1;
    const vol = typeof m.volume === 'function' ? m.volume() : NaN;
    return { sig: `${nt}|${nv}|${r6(ex)}|${r6(ey)}|${r6(ez)}|${r6(vol)}`, cx, cy, cz };
  };

  const ref = sigOf(bodies[0]);
  const centres: { cx: number; cy: number; cz: number }[] = [ref];
  for (let i = 1; i < bodies.length; i++) {
    const s = sigOf(bodies[i]);
    if (s.sig !== ref.sig) return null; // mixed composition → merged path
    centres.push(s);
  }

  // All identical. Canonical child = body[0] (kept in its own world position);
  // each instance is the pure translation of its centre relative to body[0].
  // Warp the CANONICAL child in its LOCAL frame so every instance + its edges
  // inherit the SAME displacement — matching the old shader, whose
  // `sin(transformed.z)` ran on the child's local geometry z BEFORE the
  // per-instance matrix (so all copies bent identically). Detection above used
  // the UN-warped bodies (warp by absolute z would break the identical-up-to-Z
  // signature), so this must come after the signature match. Tri count is
  // unchanged → `childTris`/`skipCutaway` below stay valid.
  const canonical = applyWarp(bodies[0], warp);
  const instances: number[][] = centres.map((c) => {
    const m = new THREE.Matrix4().makeTranslation(c.cx - ref.cx, c.cy - ref.cy, c.cz - ref.cz);
    return Array.from(m.elements as Float32Array | number[]); // column-major 16
  });

  // Cutaway skip judged on the CHILD (small), not the merged total.
  const childTris = typeof canonical.numTri === 'function' ? canonical.numTri() : 0;
  const skipCutaway = skipCutawayOpt === true ? true
    : skipCutawayOpt === false ? false
    : childTris > 15_000;

  return {
    full: manifoldToGeo(canonical, material, lut, override, crease),
    cutVC: skipCutaway ? new THREE.BufferGeometry() : manifoldToCutVC(canonical.subtract(cutBox), maxOD, material, lut, override, crease),
    manifold: scaled,
    cutawaySkipped: skipCutaway,
    instances,
  };
}

export function buildComponent(componentId: string, params: Record<string, number>): ComponentResult {
  const manifold = buildPrimitiveManifold(componentId, params);
  const maxOD = Math.max(params.od || 0, params.odTop || 0, params.odBottom || 0,
    params.odLarge || 0, params.slipOD || 0, params.odCompressed || 0, 3);
  return finalizeManifold(manifold, maxOD);
}

// Shading: use Manifold's calculateNormals(propIdx=3, minSharpAngle=60°)
// so the BufferGeometry carries geometrically correct per-vertex
// normals. THREE.computeVertexNormals after toNonIndexed() produced
// alternating bright/dark stripes on extrude+warp surfaces (thread
// cutters, helix_band) because the CSG output sometimes emits adjacent
// triangles with flipped winding — the recomputed face normals point
// in alternating directions and MeshPhongMaterial reads them as
// flickering creases. calculateNormals operates on the indexed adjacency
// directly, so it doesn't care about winding inversions, and splitting
// at the 60° threshold keeps hard corners (cylinder caps, hex faces)
// crisp.
function manifoldToGeo(manifold: any, material?: RenderMaterial, parts?: PartColorLUT, override?: ColorOverride, crease: number = DEFAULT_CREASE_ANGLE): THREE.BufferGeometry {
  let withNormals: any;
  try { withNormals = manifold.calculateNormals(3, crease); }
  catch { withNormals = manifold; }
  // Per-part colour override wins over both color-by-source and material:
  // the user explicitly painted THIS part's outside, so the full mesh is a
  // uniform outer colour (set via the indexed-geo colour attribute below).
  // Color-by-source path: go NON-INDEXED + per-triangle color from the
  // Manifold relation (parts can't share a vertex color where they meet).
  // calculateNormals preserves the relation (verified — spike TEST 4).
  if (!override && parts?.active) return colorBySourceGeo(withNormals, parts, material, false, 0);
  const mesh = withNormals.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;
  const pos = new Float32Array(nv * 3);
  const nrm = np >= 6 ? new Float32Array(nv * 3) : null;
  for (let i = 0; i < nv; i++) {
    pos[i * 3]     = vp[i * np];
    pos[i * 3 + 1] = vp[i * np + 1];
    pos[i * 3 + 2] = vp[i * np + 2];
    if (nrm) {
      nrm[i * 3]     = vp[i * np + 3];
      nrm[i * 3 + 1] = vp[i * np + 4];
      nrm[i * 3 + 2] = vp[i * np + 5];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(tri, 1));
  if (nrm) geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  else geo.computeVertexNormals();
  // When a per-part override OR a material is declared, bake a uniform
  // per-vertex `color` = outer so ComponentScene's full (non-cutaway) branch
  // can render with `vertexColors` and match the cutaway pane + GLB pane.
  // Override wins (it's the user's explicit pick). Omitted entirely on the
  // legacy/no-colour path so the existing hardcoded `color="#cc2222"` render
  // is byte-identical.
  const fullColorHex = override ? override.outer : material ? material.outer.color : null;
  if (fullColorHex) {
    const [r, g, b] = hexToRgb(fullColorHex);
    const col = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}

function manifoldToCutVC(manifold: any, maxOD: number, material?: RenderMaterial, parts?: PartColorLUT, override?: ColorOverride, crease: number = DEFAULT_CREASE_ANGLE): THREE.BufferGeometry {
  // Same calculateNormals path as manifoldToGeo — keeps shading
  // consistent across the cross-section overlay.
  let withNormals: any;
  try { withNormals = manifold.calculateNormals(3, crease); }
  catch { withNormals = manifold; }
  // Per-part colour override wins over color-by-source (user's explicit pick).
  // Color-by-source path: per-triangle color from the relation. SECTION_ID
  // (the cut-box) → cross-section color; subtractive parts already remapped
  // to the body color upstream; unknown/anonymous tools → body.
  if (!override && parts?.active) return colorBySourceGeo(withNormals, parts, material, true, maxOD);
  const mesh = withNormals.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;
  const nt = tri.length / 3;
  const pos: number[] = [];
  const norms: number[] = [];
  for (let i = 0; i < nv; i++) {
    pos.push(vp[i*np], vp[i*np+1], vp[i*np+2]);
    if (np >= 6) norms.push(vp[i*np+3], vp[i*np+4], vp[i*np+5]);
  }
  // When a material is declared, drop the tube-tuned bore/cap greying
  // heuristic entirely (it misfires on solids — see the task brief):
  // only the cut cross-section faces get material.inner; everything
  // else gets material.outer. When no material is passed, fall back to
  // the legacy red/grey heuristic byte-identically.
  const outerRgb = material ? hexToRgb(material.outer.color) : null;
  const innerRgb = material ? hexToRgb(material.inner.color) : null;
  // Per-part override RGB — when present, KEEP the legacy bore/cut/internal
  // classification (isGrey) but substitute the two configured colours:
  // outside ← outer, inside ← inner. This is "recolour the existing
  // classification", not a new one (per the task brief).
  const ovOuter = override ? hexToRgb(override.outer) : null;
  const ovInner = override ? hexToRgb(override.inner) : null;
  const outPos = new Float32Array(nt * 9);
  const outCol = new Float32Array(nt * 9);
  for (let i = 0; i < nt; i++) {
    const a=tri[i*3],b=tri[i*3+1],c=tri[i*3+2];
    const ax=pos[a*3],ay=pos[a*3+1],az=pos[a*3+2];
    const bx=pos[b*3],by=pos[b*3+1],bz=pos[b*3+2];
    const cx=pos[c*3],cy=pos[c*3+1],cz=pos[c*3+2];
    const e1x=bx-ax,e1y=by-ay,e1z=bz-az,e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
    const nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;
    const nLen=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    const mx=(ax+bx+cx)/3,my=(ay+by+cy)/3;
    const centroidR=Math.sqrt(mx*mx+my*my);
    const radialDot=centroidR>0.01?(nx*mx+ny*my)/(centroidR*nLen):0;
    const eps=0.02;
    const isBore=radialDot<-0.3;
    const onCutX=Math.abs(ax)<eps&&Math.abs(bx)<eps&&Math.abs(cx)<eps;
    const onCutY=Math.abs(ay)<eps&&Math.abs(by)<eps&&Math.abs(cy)<eps;
    const nzNorm=Math.abs(nz/nLen);
    const maxR=Math.max(Math.sqrt(ax*ax+ay*ay),Math.sqrt(bx*bx+by*by),Math.sqrt(cx*cx+cy*cy));
    let r:number,g:number,b2:number;
    if (ovOuter && ovInner) {
      // Per-part override: legacy bore/cut/internal classification, recoloured.
      const isGrey=isBore||(onCutX||onCutY)||(nzNorm>0.8&&maxR<maxOD/2+0.05);
      const rgb=isGrey?ovInner:ovOuter;
      r=rgb[0];g=rgb[1];b2=rgb[2];
    } else if (outerRgb && innerRgb) {
      // Material path: cut cross-section faces = inner, everything else = outer.
      const onCut=onCutX||onCutY;
      const rgb=onCut?innerRgb:outerRgb;
      r=rgb[0];g=rgb[1];b2=rgb[2];
    } else {
      const isGrey=isBore||(onCutX||onCutY)||(nzNorm>0.8&&maxR<maxOD/2+0.05);
      r=isGrey?0.45:0.8;g=isGrey?0.45:0.06;b2=isGrey?0.45:0.06;
    }
    const idx=i*9;
    outPos[idx]=ax;outPos[idx+1]=ay;outPos[idx+2]=az;
    outPos[idx+3]=bx;outPos[idx+4]=by;outPos[idx+5]=bz;
    outPos[idx+6]=cx;outPos[idx+7]=cy;outPos[idx+8]=cz;
    outCol[idx]=r;outCol[idx+1]=g;outCol[idx+2]=b2;
    outCol[idx+3]=r;outCol[idx+4]=g;outCol[idx+5]=b2;
    outCol[idx+6]=r;outCol[idx+7]=g;outCol[idx+8]=b2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  if (norms.length === pos.length) {
    // Scatter Manifold-computed per-vertex normals into the non-indexed
    // buffer (3 vertices per triangle, same layout as outPos).
    const outNrm = new Float32Array(nt * 9);
    for (let i = 0; i < nt; i++) {
      const a = tri[i*3], b = tri[i*3+1], c = tri[i*3+2];
      const idx = i*9;
      outNrm[idx]=norms[a*3];     outNrm[idx+1]=norms[a*3+1]; outNrm[idx+2]=norms[a*3+2];
      outNrm[idx+3]=norms[b*3];   outNrm[idx+4]=norms[b*3+1]; outNrm[idx+5]=norms[b*3+2];
      outNrm[idx+6]=norms[c*3];   outNrm[idx+7]=norms[c*3+1]; outNrm[idx+8]=norms[c*3+2];
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Concatenate NON-INDEXED BufferGeometries by appending their position /
 * normal / color attributes. Every cutVC geometry (the legacy red/grey
 * heuristic, the material path, the per-part override, AND the color-by-source
 * path) is non-indexed and carries position + color + a normal attribute, so a
 * flat attribute concat is exact — there is no index buffer to renumber. An
 * attribute is carried only when EVERY input geo has it (defensive). Empty
 * inputs (a body fully removed by the cut) contribute zero vertices. Used by
 * the per-body cutaway path (`cutawayVC`); no equivalent helper exists in the
 * repo (no THREE BufferGeometryUtils bundled).
 */
function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  if (geos.length === 0) return out;
  if (geos.length === 1) return geos[0];
  for (const name of ['position', 'normal', 'color'] as const) {
    if (!geos.every((g) => g.getAttribute(name))) continue;
    const first = geos[0].getAttribute(name) as THREE.BufferAttribute;
    const itemSize = first.itemSize;
    let total = 0;
    for (const g of geos) total += (g.getAttribute(name) as THREE.BufferAttribute).array.length;
    const merged = new Float32Array(total);
    let off = 0;
    for (const g of geos) {
      const arr = (g.getAttribute(name) as THREE.BufferAttribute).array as ArrayLike<number>;
      merged.set(arr as Float32Array, off);
      off += arr.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, itemSize));
  }
  return out;
}

/**
 * Compute the half-cutaway cross-section geometry (`cutVC`) for a finalized
 * manifold, PER-BODY where possible. The cut is DISTRIBUTIVE over `compose`:
 * composed bodies occupy disjoint regions and `M.compose` merges meshes without
 * fusing them, so for the global cut-box C
 *   (A ∪ B).subtract(C)  ≡  A.subtract(C) ∪ B.subtract(C).
 * That equivalence lets us cut each (small) body separately and merge the
 * resulting cross-section geometries. The dominant cutaway cost is actually the
 * `calculateNormals(3,60)` that `manifoldToCutVC` runs over the subtracted
 * result — it scales SUPER-linearly in triangle count (measured: 30k→204ms,
 * 100k→3776ms), and one pass over the whole N-copy stack is what forced the old
 * 15k-tri skip (long strings showed NO cutaway). Running it per body instead
 * (Σ O(N_body) ≈ linear) drops a 50-body stack's cutaway from ~3.8s to ~0.16s
 * (≈26×, measured), so the cutaway can be computed by default for normal long
 * stacks. The boolean subtract itself is cheap and roughly linear either way;
 * decompose distributes both.
 *
 * `decompose()` preserves `runOriginalID` (verified in scripts/spike_csg_originalid.ts),
 * so color-by-source survives the round-trip; the SECTION_ID-tagged cutBox stamps
 * each per-body cross-section face exactly as the monolithic path did. Single body
 * (or decompose unavailable / throwing / ≤1 body) falls through to the original
 * monolithic `manifoldToCutVC(scaled.subtract(cutBox), …)` — BYTE-IDENTICAL to the
 * pre-change output. Any error anywhere falls back to that same monolithic path
 * (bulletproof).
 */
function cutawayVC(
  scaled: any,
  cutBox: any,
  maxOD: number,
  material?: RenderMaterial,
  parts?: PartColorLUT,
  override?: ColorOverride,
  crease: number = DEFAULT_CREASE_ANGLE,
): THREE.BufferGeometry {
  try {
    if (typeof scaled.decompose === 'function') {
      const bodies = scaled.decompose();
      if (Array.isArray(bodies) && bodies.length > 1) {
        const geos = bodies.map((b: any) =>
          manifoldToCutVC(b.subtract(cutBox), maxOD, material, parts, override, crease),
        );
        return mergeBufferGeometries(geos);
      }
    }
  } catch {
    // decompose missing / threw / per-body cut failed → monolithic fallback.
  }
  return manifoldToCutVC(scaled.subtract(cutBox), maxOD, material, parts, override, crease);
}

/**
 * Build a NON-INDEXED BufferGeometry colored per-triangle by source part,
 * read from the Manifold relation (runOriginalID/runIndex). Shared by the
 * full + cutaway renderers' color-by-source path.
 *
 *   id == SECTION_ID   → body inner (the half-cutaway cross-section reveal)
 *   id ∈ subtractive   → that tool's INNER color (the bore/cut wall)
 *   id ∈ outer         → that part's OUTER color (external skin)
 *   anything else      → body outer (anonymous tools / untagged)
 *
 * `withNormals` is the post-calculateNormals manifold (numProp ≥ 6 carries
 * per-vertex normals at slots 3..5), so we scatter Manifold's normals into
 * the non-indexed buffer just like the legacy cutVC path.
 */
function colorBySourceGeo(
  withNormals: any,
  parts: PartColorLUT,
  _material: RenderMaterial | undefined,
  _isCut: boolean,
  _maxOD: number,
): THREE.BufferGeometry {
  const mesh = withNormals.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nt = tri.length / 3;
  const hasNrm = np >= 6;
  const ids = triSourceIds(mesh);
  const outerRgb = rgbMap(parts.outer);
  const innerRgb = rgbMap(parts.inner);
  const subtractive = new Set(parts.subtractive);
  const bodyInnerRgb = hexToRgb(parts.bodyInner);
  const bodyOuterRgb: [number, number, number] =
    (parts.bodyId != null && outerRgb.get(parts.bodyId)) || hexToRgb(parts.bodyColor);

  const outPos = new Float32Array(nt * 9);
  const outCol = new Float32Array(nt * 9);
  const outNrm = hasNrm ? new Float32Array(nt * 9) : null;
  for (let i = 0; i < nt; i++) {
    const id = ids[i];
    let rgb: [number, number, number];
    if (id === SECTION_ID) rgb = bodyInnerRgb;          // cross-section reveal
    else if (subtractive.has(id)) rgb = innerRgb.get(id) ?? bodyInnerRgb; // cut/bore wall
    else rgb = outerRgb.get(id) ?? bodyOuterRgb;        // external skin
    const idx = i * 9;
    for (let v = 0; v < 3; v++) {
      const vi = tri[i * 3 + v];
      outPos[idx + v * 3]     = vp[vi * np];
      outPos[idx + v * 3 + 1] = vp[vi * np + 1];
      outPos[idx + v * 3 + 2] = vp[vi * np + 2];
      outCol[idx + v * 3]     = rgb[0];
      outCol[idx + v * 3 + 1] = rgb[1];
      outCol[idx + v * 3 + 2] = rgb[2];
      if (outNrm) {
        outNrm[idx + v * 3]     = vp[vi * np + 3];
        outNrm[idx + v * 3 + 1] = vp[vi * np + 4];
        outNrm[idx + v * 3 + 2] = vp[vi * np + 5];
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  if (outNrm) geo.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  else geo.computeVertexNormals();
  return geo;
}
