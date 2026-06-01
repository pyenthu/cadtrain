/**
 * Browser-side ManifoldCAD builder for Ratch-Latch Receiving Head
 * Takes AssemblyParams → builds geometry → returns Three.js BufferGeometries
 */

import Module from 'manifold-3d';
import * as THREE from 'three';
import { deriveBody, type AssemblyParams } from './assembly';

let wasm: any = null;
let M: any = null;

export async function initManifold() {
  if (wasm) return;
  wasm = await Module();
  wasm.setup();
  M = wasm.Manifold;
  wasm.setCircularSegments(192);
  console.log('ManifoldCAD initialized (Ratch-Latch)');
}

function cyl(h: number, r1: number, r2?: number) { return M.cylinder(h, r1, r2 ?? r1, 192); }
function tube(outerR: number, innerR: number, h: number) { return cyl(h, outerR).subtract(cyl(h + 0.02, innerR)); }
function mv(m: any, v: [number, number, number]) { return m.translate(v); }

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
  return geo;
}

function manifoldToCutVCGeo(manifold: any, params: AssemblyParams): THREE.BufferGeometry {
  const b = params.body;
  const s = params.seal;
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
    const a = tri[i*3], b2 = tri[i*3+1], c = tri[i*3+2];
    const ax=pos[a*3],ay=pos[a*3+1],az=pos[a*3+2];
    const bx=pos[b2*3],by=pos[b2*3+1],bz=pos[b2*3+2];
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
    const isInnerFlat=nzNorm>0.8&&maxR<(b.upperOD/2+0.05);
    const isMandrel=centroidR<(params.mandrel.mandrelOD/2+0.05)&&centroidR>(params.mandrel.mandrelID/2-0.05);

    const isGrey=isBore||isCutFace||isInnerFlat||isMandrel;
    const r=isGrey?0.45:0.8,g=isGrey?0.45:0.06,b3=isGrey?0.45:0.06;

    const idx = i * 9;
    outPos[idx]=ax;outPos[idx+1]=ay;outPos[idx+2]=az;
    outPos[idx+3]=bx;outPos[idx+4]=by;outPos[idx+5]=bz;
    outPos[idx+6]=cx;outPos[idx+7]=cy;outPos[idx+8]=cz;
    outCol[idx]=r;outCol[idx+1]=g;outCol[idx+2]=b3;
    outCol[idx+3]=r;outCol[idx+4]=g;outCol[idx+5]=b3;
    outCol[idx+6]=r;outCol[idx+7]=g;outCol[idx+8]=b3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface BuildResult {
  bodyFull: THREE.BufferGeometry;
  bodyCutVC: THREE.BufferGeometry;
  mandrelFull: THREE.BufferGeometry;
  mandrelCut: THREE.BufferGeometry;
  sealFull: THREE.BufferGeometry;
  sealCut: THREE.BufferGeometry;
}

export function buildGeometry(params: AssemblyParams): BuildResult {
  const b = params.body;
  const m = params.mandrel;
  const s = params.seal;
  const { upperID, lowerID } = deriveBody(b);

  let z = 0; // build top-down, z increases downward

  // ═══ BODY ═══

  // Top cap
  let solid = cyl(b.topCapLength, b.topCapOD / 2);
  z += b.topCapLength;

  // Threaded neck (slightly narrower)
  solid = solid.add(mv(cyl(b.threadLength, b.threadOD / 2), [0, 0, z]));
  const threadStart = z;
  z += b.threadLength;

  // Upper body
  solid = solid.add(mv(cyl(b.upperLength, b.upperOD / 2), [0, 0, z]));
  z += b.upperLength;

  // Shoulder taper (upper OD → shoulder OD)
  solid = solid.add(mv(cyl(b.shoulderTaperH, b.upperOD / 2, b.shoulderOD / 2), [0, 0, z]));
  z += b.shoulderTaperH;

  // Lower body at shoulder OD, then back to lower OD
  solid = solid.add(mv(cyl(b.lowerLength, b.lowerOD / 2), [0, 0, z]));
  const lowerStart = z;
  z += b.lowerLength;

  // Bottom taper
  solid = solid.add(mv(cyl(b.bottomTaperH, b.lowerOD / 2, b.bottomOD / 2), [0, 0, z]));
  z += b.bottomTaperH;

  const totalH = z;

  // Bore through everything
  let bore = cyl(totalH + 0.2, upperID / 2);
  bore = bore.add(mv(cyl(b.lowerLength + b.bottomTaperH + 0.2, lowerID / 2), [0, 0, lowerStart - 0.1]));

  let body = solid.subtract(mv(bore, [0, 0, -0.1]));

  // External threads on neck
  for (let i = 0; i < b.numThreads; i++) {
    const tz = threadStart + b.threadLength * (i + 0.5) / b.numThreads;
    const thread = mv(tube(b.threadOD / 2 + 0.01, b.threadOD / 2 - b.threadDepth, 0.05), [0, 0, tz]);
    body = body.subtract(thread);
  }

  // ═══ MANDREL ═══
  let mandrel = tube(m.mandrelOD / 2, m.mandrelID / 2, m.mandrelLength);
  mandrel = mv(mandrel, [0, 0, m.mandrelOffset]);

  // ═══ SEAL ═══
  const sealR = s.sealOD / 2;
  let sealRing = tube(sealR, m.mandrelOD / 2, s.sealHeight);
  // Cut seal grooves
  const grooveSpacing = s.sealHeight / (s.numSeals + 1);
  for (let i = 0; i < s.numSeals; i++) {
    const gz = grooveSpacing * (i + 1);
    const groove = mv(tube(sealR + 0.01, sealR - s.grooveDepth, 0.06), [0, 0, gz]);
    sealRing = sealRing.subtract(groove);
  }
  sealRing = mv(sealRing, [0, 0, s.sealOffset]);

  // ═══ CUT ═══
  const cutBox = M.cube([20, 20, 50], false).translate([0, 0, -25]);

  return {
    bodyFull: manifoldToGeo(body),
    bodyCutVC: manifoldToCutVCGeo(body.subtract(cutBox), params),
    mandrelFull: manifoldToGeo(mandrel),
    mandrelCut: manifoldToGeo(mandrel.subtract(cutBox)),
    sealFull: manifoldToGeo(sealRing),
    sealCut: manifoldToGeo(sealRing.subtract(cutBox)),
  };
}
