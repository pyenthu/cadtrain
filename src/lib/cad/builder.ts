/**
 * Component Builder — ManifoldCAD geometry for each primitive
 */

import * as THREE from 'three';
import { COMPONENTS } from './library';
import { geomById, metaById, resolveDerived } from './components';
// Manifold runtime + small helpers live in their own module so per-primitive
// component files can import them without depending on builder.ts. Re-exported
// here for back-compat with anything still importing them from this file.
import { M, cyl, tube, mv, rot, getCutBox } from './manifold-helpers';
export { CIRCULAR_SEGMENTS_DEFAULT, CIRCULAR_SEGMENTS_COMPOSE, setCircularSegmentMode, initManifold } from './manifold-helpers';

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
}

/**
 * Build a raw primitive manifold from the library, without any centering
 * or cutaway processing. Used by the composition interpreter
 * (src/lib/authoring/compose.ts) which needs to apply its own transforms
 * before finalizing. If you want a ready-to-render geometry, use
 * `buildComponent` instead.
 */
export function buildPrimitiveManifold(componentId: string, params: Record<string, number>): any {
  // Runes registry takes precedence — single-file primitives in
  // ./components/<id>.ts are the source of truth for any id they define.
  // Derived params (meta.derived) are computed and merged into the bag
  // BEFORE geom runs, so the geom can read p.<derivedKey> naturally.
  const componentGeom = geomById(componentId);
  if (componentGeom) {
    const meta = metaById(componentId);
    const resolved = meta ? resolveDerived(meta, params) : params;
    return componentGeom(resolved);
  }

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
export function finalizeManifold(manifold: any, maxOD: number): ComponentResult {
  const scaled = _renderZScale === 1.0 ? manifold : manifold.scale([1, 1, _renderZScale]);
  return {
    full: manifoldToGeo(scaled),
    cutVC: manifoldToCutVC(scaled.subtract(getCutBox()), maxOD),
    manifold: scaled,
  };
}

export function buildComponent(componentId: string, params: Record<string, number>): ComponentResult {
  const manifold = buildPrimitiveManifold(componentId, params);
  const maxOD = Math.max(params.od || 0, params.odTop || 0, params.odBottom || 0,
    params.odLarge || 0, params.slipOD || 0, params.odCompressed || 0, 3);
  return finalizeManifold(manifold, maxOD);
}

// TODO(shading): two known visual artifacts in this path, kept on the
// flat-shading approach for now because the alternative
// (manifold.calculateNormals + smooth shading) looked dull / dim
// compared to GLB. Both are low-priority polish, not correctness:
//
//   1. CrossSection.extrude with twist / scaleTop (helix_band,
//      profile_extrude with non-zero twist) produces side triangles
//      with inconsistent winding. computeVertexNormals then flips
//      alternating face normals → bright white "tooth" stripes show
//      through backface-culled triangles. Reproduces clearly on
//      profile_extrude with twistDegrees != 0 — screenshot
//      ~/Desktop/Screenshot 2026-05-19 at 5.34.46 AM.png.
//   2. M.cylinder / M.cube show a single dark vertical seam where the
//      circumference closes back on vertex 0 — the duplicated seam
//      verts have slightly different normals from the cap-edge split,
//      and the Edges overlay (thresholdAngle=20) draws a line.
//      Visible on tube primitives — screenshot
//      ~/Desktop/Screenshot 2026-05-19 at 5.34.00 AM.png.
//
// Fix candidates (when we pick this back up):
//   - Re-orient flipped triangles by signed-volume test before
//     computeVertexNormals (cheap, targets root cause).
//   - Switch to manifold.calculateNormals(3, minSharpAngle) + bake a
//     small specular-boost into the material so the smooth-shading
//     trade-off stops being visible.
//   - Raise the Edges overlay thresholdAngle from 20° to ~35° to
//     suppress the cylinder seam without hiding real creases.
function manifoldToGeo(manifold: any): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2];
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  indexed.setIndex(new THREE.BufferAttribute(tri, 1));
  const geo = indexed.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}

function manifoldToCutVC(manifold: any, maxOD: number): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;
  const nt = tri.length / 3;
  const pos: number[] = [];
  for (let i = 0; i < nv; i++) pos.push(vp[i*np], vp[i*np+1], vp[i*np+2]);
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
    const isGrey=isBore||(onCutX||onCutY)||(nzNorm>0.8&&maxR<maxOD/2+0.05);
    const r=isGrey?0.45:0.8,g=isGrey?0.45:0.06,b2=isGrey?0.45:0.06;
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
  geo.computeVertexNormals();
  return geo;
}
