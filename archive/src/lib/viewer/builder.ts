/**
 * Generic tool builder — takes VLM analysis JSON → ManifoldCAD geometry → Three.js
 * Works for any cylindrical downhole tool described as sections.
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
  wasm.setCircularSegments(192);
  console.log('ManifoldCAD initialized (generic builder)');
}

function cyl(h: number, r1: number, r2?: number) { return M.cylinder(h, r1, r2 ?? r1, 192); }
function tube(outerR: number, innerR: number, h: number) { return cyl(h, outerR).subtract(cyl(h + 0.02, innerR)); }
function mv(m: any, v: [number, number, number]) { return m.translate(v); }

export interface ToolSection {
  name: string;
  shape: string;        // cylinder | cone
  od: number;           // normalized 0-1
  od_bottom?: number;   // for cones
  wall_thickness: number;
  length: number;       // proportion of total height
  features: string[];
  color: string;        // red | grey
}

export interface ToolAnalysis {
  tool_name: string;
  aspect_ratio: number;
  sections: ToolSection[];
  bore_profile?: { position: number; inner_diameter: number }[];
}

export interface ToolParams {
  scale: number;        // overall scale (max OD in real units)
  totalHeight: number;  // total height in real units
  wallScale: number;    // multiplier for wall thicknesses
  boreScale: number;    // multiplier for bore diameter
}

export const DEFAULT_TOOL_PARAMS: ToolParams = {
  scale: 2.4,
  totalHeight: 12.0,
  wallScale: 1.0,
  boreScale: 1.0,
};

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
    const isInnerFlat=nzNorm>0.8&&maxR<(maxOD/2+0.05);
    const isGrey=isBore||isCutFace||isInnerFlat;
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

export interface BuildResult {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
}

export function buildFromAnalysis(analysis: ToolAnalysis, params: ToolParams = DEFAULT_TOOL_PARAMS): BuildResult {
  const S = params.scale;
  const H = params.totalHeight;

  let z = 0;
  let solid = M.cube([0.001, 0.001, 0.001], true); // dummy seed

  // Build each section
  for (const sec of analysis.sections) {
    const secH = sec.length * H;
    const r1 = (sec.od * S) / 2;
    const r2 = sec.od_bottom !== undefined ? (sec.od_bottom * S) / 2 : r1;

    if (sec.shape === 'cone' && r1 !== r2) {
      solid = solid.add(mv(cyl(secH, r1, r2), [0, 0, z]));
    } else {
      solid = solid.add(mv(cyl(secH, r1), [0, 0, z]));
    }

    // Thread grooves
    if (sec.features.some((f: string) => f.includes('thread'))) {
      const threadCount = Math.max(4, Math.round(secH / 0.15));
      const threadDepth = Math.min(0.08, r1 * 0.06);
      const grooveH = Math.min(0.05, secH / threadCount * 0.7);
      for (let i = 0; i < threadCount; i++) {
        const tz = z + secH * (i + 0.5) / threadCount;
        const tr = Math.min(r1, r2);
        const groove = mv(tube(tr + 0.01, tr - threadDepth, grooveH), [0, 0, tz]);
        solid = solid.subtract(groove);
      }
    }

    z += secH;
  }

  // Bore — use bore_profile if available, else use wall_thickness
  let bore = M.cube([0.001, 0.001, 0.001], true);
  if (analysis.bore_profile && analysis.bore_profile.length >= 2) {
    for (let i = 0; i < analysis.bore_profile.length - 1; i++) {
      const bp1 = analysis.bore_profile[i];
      const bp2 = analysis.bore_profile[i + 1];
      const bz1 = bp1.position * H;
      const bz2 = bp2.position * H;
      const br1 = (bp1.inner_diameter * S * params.boreScale) / 2;
      const br2 = (bp2.inner_diameter * S * params.boreScale) / 2;
      const bh = bz2 - bz1;
      if (bh > 0.001) {
        bore = bore.add(mv(cyl(bh + 0.01, br1, br2), [0, 0, bz1 - 0.005]));
      }
    }
  } else {
    // Fallback: uniform bore from average wall thickness
    const avgWall = analysis.sections.reduce((s, sec) => s + sec.wall_thickness, 0) / analysis.sections.length;
    const boreR = (S * (1.0 - 2 * avgWall) * params.boreScale) / 2;
    bore = cyl(H + 0.2, boreR);
    bore = mv(bore, [0, 0, -0.1]);
  }

  const centered = solid.subtract(bore).translate([0, 0, -H / 2]);
  const maxOD = S;

  // Cut
  const cutBox = M.cube([20, 20, 100], false).translate([0, 0, -50]);

  return {
    full: manifoldToGeo(centered),
    cutVC: manifoldToCutVC(centered.subtract(cutBox), maxOD),
  };
}
