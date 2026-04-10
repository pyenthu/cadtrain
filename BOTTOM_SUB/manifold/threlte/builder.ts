/**
 * Browser-side ManifoldCAD builder
 * Takes AssemblyParams → builds geometry → returns Three.js BufferGeometries
 */

import Module from 'manifold-3d';
import * as THREE from 'three';
import type { AssemblyParams } from '../assembly';

let wasm: any = null;
let M: any = null;

export async function initManifold() {
  if (wasm) return;
  wasm = await Module();
  wasm.setup();
  M = wasm.Manifold;
  wasm.setCircularSegments(192);
  console.log('ManifoldCAD initialized in browser');
}

function cyl(h: number, r1: number, r2?: number) { return M.cylinder(h, r1, r2 ?? r1, 192); }
function cube(x: number, y: number, z: number, center = false) { return M.cube([x, y, z], center); }
function tube(outerR: number, innerR: number, h: number) { return cyl(h, outerR).subtract(cyl(h + 0.02, innerR)); }
function mv(m: any, v: [number, number, number]) { return m.translate(v); }
function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

function manifoldToGeo(manifold: any): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;

  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = vp[i * np];
    pos[i * 3 + 1] = vp[i * np + 1];
    pos[i * 3 + 2] = vp[i * np + 2];
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  indexed.setIndex(new THREE.BufferAttribute(tri, 1));
  const geo = indexed.toNonIndexed();
  geo.computeVertexNormals();
  geo.rotateX(Math.PI);
  return geo;
}

function manifoldToCutVCGeo(manifold: any, params: AssemblyParams): THREE.BufferGeometry {
  const h = params.housing;
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
    const a = tri[i*3], b = tri[i*3+1], c = tri[i*3+2];
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
    const isCutFace=onCutX||onCutY;
    const nzNorm=Math.abs(nz/nLen);
    const maxR=Math.max(Math.sqrt(ax*ax+ay*ay),Math.sqrt(bx*bx+by*by),Math.sqrt(cx*cx+cy*cy));
    const isInnerFlat=nzNorm>0.8&&maxR<(h.bodyOD/2+0.05);

    const isGrey=isBore||isCutFace||isInnerFlat;
    const r=isGrey?0.45:0.8,g=isGrey?0.45:0.06,b2=isGrey?0.45:0.06;

    const idx = i * 9;
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
  geo.rotateX(Math.PI);
  return geo;
}

export interface BuildResult {
  housingFull: THREE.BufferGeometry;
  housingCutVC: THREE.BufferGeometry;
  slipsFull: THREE.BufferGeometry;
  slipsCut: THREE.BufferGeometry;
  sleeveFull: THREE.BufferGeometry;
  sleeveCut: THREE.BufferGeometry;
}

export function buildGeometry(params: AssemblyParams): BuildResult {
  const h = params.housing;
  const s = params.sleeve;
  const sl = params.slips;

  // Housing solid
  let solid = cyl(h.bodyLength, h.bodyOD / 2);
  solid = solid.add(mv(cyl(h.taperLength, h.bodyOD / 2, h.taperTopOD / 2), [0, 0, h.bodyLength]));
  solid = solid.add(mv(cyl(h.flatTopLength, h.taperTopOD / 2), [0, 0, h.bodyLength + h.taperLength]));
  solid = solid.add(mv(cyl(h.lowerLength, h.lowerOD / 2), [0, 0, -h.lowerLength]));
  solid = solid.add(mv(cyl(h.bottomTaperH, h.bottomNeckOD / 2, h.lowerOD / 2), [0, 0, -h.lowerLength - h.bottomTaperH]));

  // Bore
  let bore = mv(cyl(h.bodyLength + h.taperLength + h.flatTopLength + 0.5, h.bodyID / 2), [0, 0, -0.1]);
  bore = bore.add(mv(cyl(h.lowerLength + 0.1, h.lowerID / 2), [0, 0, -h.lowerLength - 0.1]));
  bore = bore.add(mv(cyl(h.bottomTaperH + 0.1, h.bottomBoreID / 2), [0, 0, -h.lowerLength - h.bottomTaperH - 0.05]));

  let housing = solid.subtract(bore);

  // Threads
  for (let i = 0; i < h.numThreads; i++) {
    const tz = -h.lowerLength + h.lowerLength * (i + 0.5) / (h.numThreads + 1);
    housing = housing.subtract(mv(tube(h.lowerID / 2 + h.threadDepth, h.lowerID / 2 - 0.01, 0.06), [0, 0, tz]));
  }

  // Pins
  for (let i = 0; i < s.numPins; i++) {
    const pinZ = h.bodyLength * 0.3 + i * s.pinSpacing;
    let pin = rot(cyl(s.pinLength, s.pinRadius), [90, 0, 0]);
    housing = housing.add(mv(pin, [0, -(h.bodyID / 2 + s.pinLength / 2 - 0.1), pinZ]));
    let pin2 = rot(cyl(s.pinLength, s.pinRadius), [90, 0, 0]);
    housing = housing.add(mv(pin2, [0, (h.bodyID / 2 - s.pinLength / 2 + 0.1), pinZ]));
  }

  // Slips — straight body, each groove has sawtooth/tapered profile
  const slipR = sl.slipOD / 2;
  let slipRing = tube(slipR, h.bodyOD / 2, sl.slipHeight);
  // Cut sector gaps
  for (let i = 0; i < sl.numSectors; i++) {
    const gap = mv(rot(cube(sl.slipOD + 1, sl.gapWidth, sl.slipHeight + 1, true), [0, 0, i * (360 / sl.numSectors)]), [0, 0, sl.slipHeight / 2]);
    slipRing = slipRing.subtract(gap);
  }
  // Cut grooves — sawtooth on the OUTER surface
  // Each tooth: sharp edge at one end, ramps outward to full OD at the other end
  // We subtract a tapered ring from the outside
  const grooveH = sl.slipHeight / sl.numGrooves;
  for (let i = 0; i < sl.numGrooves; i++) {
    const gz = grooveH * i;
    // Big cylinder that covers outside, tapered to cut a ramp into the outer surface
    // taperDirection: 1 = sharp edge at bottom of each tooth (ramp up)
    const cutOuterR = slipR + 0.5; // bigger than slip to ensure full cut
    if (sl.taperDirection >= 0) {
      // Sharp at bottom, ramps up: top of groove is at (slipR - grooveDepth), bottom at slipR
      const taperCut = cyl(grooveH * 0.85, cutOuterR, cutOuterR);
      const taperKeep = cyl(grooveH * 0.85 + 0.01, slipR - sl.grooveDepth, slipR);
      slipRing = slipRing.subtract(mv(taperCut.subtract(taperKeep), [0, 0, gz + grooveH * 0.05]));
    } else {
      // Sharp at top, ramps down
      const taperCut = cyl(grooveH * 0.85, cutOuterR, cutOuterR);
      const taperKeep = cyl(grooveH * 0.85 + 0.01, slipR, slipR - sl.grooveDepth);
      slipRing = slipRing.subtract(mv(taperCut.subtract(taperKeep), [0, 0, gz + grooveH * 0.05]));
    }
  }
  const slips = mv(slipRing, [0, 0, sl.slipOffset]);

  // Sleeve
  const sleeve = mv(tube(s.sleeveOD / 2, s.sleeveID / 2, s.sleeveLength), [0, 0, s.sleeveOffset]);

  // Cut
  const cutBox = M.cube([20, 20, 50], false).translate([0, 0, -25]);

  return {
    housingFull: manifoldToGeo(housing),
    housingCutVC: manifoldToCutVCGeo(housing.subtract(cutBox), params),
    slipsFull: manifoldToGeo(slips),
    slipsCut: manifoldToGeo(slips.subtract(cutBox)),
    sleeveFull: manifoldToGeo(sleeve),
    sleeveCut: manifoldToGeo(sleeve.subtract(cutBox)),
  };
}
