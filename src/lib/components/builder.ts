/**
 * Component Builder — ManifoldCAD geometry for each primitive
 */

import Module from 'manifold-3d';
import * as THREE from 'three';

let wasm: any = null;
let M: any = null;

export async function initManifold() {
  if (wasm) return;
  wasm = await Module();
  wasm.setup();
  M = wasm.Manifold;
  wasm.setCircularSegments(256);
}

function cyl(h: number, r1: number, r2?: number) { return M.cylinder(h, r1, r2 ?? r1, 256); }
function tube(outerR: number, innerR: number, h: number) { return cyl(h, outerR).subtract(cyl(h + 0.02, innerR)); }
function mv(m: any, v: [number, number, number]) { return m.translate(v); }
function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

// ═══ BUILDERS ═══

const builders: Record<string, (p: Record<string, number>) => any> = {

  hollow_cylinder(p) {
    const id = p.od - 2 * p.wall;
    return tube(p.od / 2, id / 2, p.length);
  },

  threaded_box(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    // Internal threads (grooves cut into bore)
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.length * (i + 0.5) / p.threadCount;
      body = body.subtract(mv(tube(id / 2 + p.threadDepth, id / 2 - 0.01, 0.05), [0, 0, tz]));
    }
    return body;
  },

  threaded_pin(p) {
    const id = p.od - 2 * p.wall;
    let body = tube(p.od / 2, id / 2, p.length);
    // External threads (grooves cut into OD)
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.length * (i + 0.5) / p.threadCount;
      body = body.subtract(mv(tube(p.od / 2 + 0.01, p.od / 2 - p.threadDepth, 0.04), [0, 0, tz]));
    }
    return body;
  },

  thread_reg(p) {
    // REG: body → shoulder → tapered pin with threads
    const id = p.bodyOD - 2 * p.wall;
    let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
    // Shoulder face
    const shoulderR = (p.bodyOD - p.pinOD) / 2;
    body = body.add(mv(cyl(p.shoulderWidth, p.bodyOD / 2), [0, 0, p.bodyLength]));
    // Tapered pin
    const pinTopR = p.pinOD / 2;
    const pinBotR = pinTopR - p.pinTaper * p.pinLength;
    const pinID = id / 2;
    let pin = cyl(p.pinLength, pinTopR, pinBotR).subtract(cyl(p.pinLength + 0.02, pinID, pinID));
    pin = mv(pin, [0, 0, p.bodyLength + p.shoulderWidth]);
    // Cut threads into pin
    for (let i = 0; i < p.threadCount; i++) {
      const tz = p.bodyLength + p.shoulderWidth + p.pinLength * (i + 0.5) / p.threadCount;
      const localR = pinTopR - p.pinTaper * (p.pinLength * (i + 0.5) / p.threadCount);
      pin = pin.subtract(mv(tube(localR + 0.01, localR - p.threadDepth, 0.04), [0, 0, tz]));
    }
    return body.add(pin);
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

  cone(p) {
    const idTop = p.odTop - 2 * p.wall;
    const idBottom = p.odBottom - 2 * p.wall;
    return cyl(p.length, p.odTop / 2, p.odBottom / 2).subtract(
      mv(cyl(p.length + 0.02, idTop / 2, idBottom / 2), [0, 0, -0.01])
    );
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

export function buildComponent(componentId: string, params: Record<string, number>): ComponentResult {
  const builderFn = builders[componentId];
  if (!builderFn) throw new Error(`Unknown component: ${componentId}`);

  let manifold = builderFn(params);

  // Center vertically
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const np = mesh.numProp;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vp.length / np; i++) {
    const z = vp[i * np + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  manifold = manifold.translate([0, 0, -(minZ + maxZ) / 2]);

  const maxOD = Math.max(params.od || 0, params.odTop || 0, params.odBottom || 0,
    params.odLarge || 0, params.slipOD || 0, params.odCompressed || 0, 3);

  const cutBox = M.cube([20, 20, 100], false).translate([0, 0, -50]);

  return {
    full: manifoldToGeo(manifold),
    cutVC: manifoldToCutVC(manifold.subtract(cutBox), maxOD),
    manifold,
  };
}

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
