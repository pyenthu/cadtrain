/**
 * Parametric Bottom Sub Builder
 * Takes AssemblyParams → produces ManifoldCAD geometry
 */

import Module from "manifold-3d";
import { DEFAULT_PARAMS, type AssemblyParams } from "./assembly";

const wasm = await Module();
wasm.setup();
const M = wasm.Manifold;
wasm.setCircularSegments(192);

function cyl(h: number, r1: number, r2?: number) { return M.cylinder(h, r1, r2 ?? r1, 192); }
function cube(x: number, y: number, z: number, center = false) { return M.cube([x, y, z], center); }
function tube(outerR: number, innerR: number, h: number) { return cyl(h, outerR).subtract(cyl(h + 0.02, innerR)); }
function mv(m: any, v: [number, number, number]) { return m.translate(v); }
function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

export function buildAssembly(params: AssemblyParams = DEFAULT_PARAMS) {
  const h = params.housing;
  const s = params.sleeve;
  const sl = params.slips;

  console.log("Building with params:", JSON.stringify(params, null, 2).slice(0, 200) + "...");

  // ═══ HOUSING ═══
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
  console.log("  Housing:", housing.numVert(), "verts");

  // Internal threads
  for (let i = 0; i < h.numThreads; i++) {
    const tz = -h.lowerLength + h.lowerLength * (i + 0.5) / (h.numThreads + 1);
    const thread = mv(tube(h.lowerID / 2 + h.threadDepth, h.lowerID / 2 - 0.01, 0.06), [0, 0, tz]);
    housing = housing.subtract(thread);
  }

  // ═══ SLIPS ═══
  let slipRing = tube(sl.slipOD / 2, h.bodyOD / 2, sl.slipHeight);
  for (let i = 0; i < sl.numSectors; i++) {
    const gap = mv(rot(cube(sl.slipOD + 1, sl.gapWidth, sl.slipHeight + 1, true), [0, 0, i * (360 / sl.numSectors)]), [0, 0, sl.slipHeight / 2]);
    slipRing = slipRing.subtract(gap);
  }
  for (let i = 0; i < sl.numGrooves; i++) {
    const gz = sl.slipHeight * (i + 0.5) / sl.numGrooves;
    const groove = mv(tube(sl.slipOD / 2 + 0.01, sl.slipOD / 2 - sl.grooveDepth, 0.04), [0, 0, gz]);
    slipRing = slipRing.subtract(groove);
  }
  const slips = mv(slipRing, [0, 0, sl.slipOffset]);
  console.log("  Slips:", slips.numVert(), "verts");

  // ═══ SLEEVE ═══
  let sleeve = tube(s.sleeveOD / 2, s.sleeveID / 2, s.sleeveLength);
  sleeve = mv(sleeve, [0, 0, s.sleeveOffset]);
  console.log("  Sleeve:", sleeve.numVert(), "verts");

  // ═══ SHEAR PINS ═══
  let pins = M.cube([0.001, 0.001, 0.001], true); // dummy start
  for (let i = 0; i < s.numPins; i++) {
    const pinZ = h.bodyLength * 0.3 + i * s.pinSpacing;
    let pin = rot(cyl(s.pinLength, s.pinRadius), [90, 0, 0]);
    pin = mv(pin, [0, -(h.bodyID / 2 + s.pinLength / 2 - 0.1), pinZ]);
    pins = pins.add(pin);
    let pin2 = rot(cyl(s.pinLength, s.pinRadius), [90, 0, 0]);
    pin2 = mv(pin2, [0, (h.bodyID / 2 - s.pinLength / 2 + 0.1), pinZ]);
    pins = pins.add(pin2);
  }

  // ═══ COMBINE ═══
  let model = housing.add(slips).add(sleeve).add(pins);
  console.log("  FULL:", model.numVert(), "verts,", model.numTri(), "tris");

  // Keep individual components for separate export
  const housingWithPins = housing.add(pins);

  return { model, housing: housingWithPins, slips, sleeve, params };
}

// ═══ Main: build + cut + export ═══
const params = DEFAULT_PARAMS;
const { model, housing, slips, sleeve } = buildAssembly(params);

const cutBox = M.cube([20, 20, 50], false).translate([0, 0, -25]);

// Cut each component separately
const cutHousing = housing.subtract(cutBox);
const cutSlips = slips.subtract(cutBox);
const cutSleeve = sleeve.subtract(cutBox);
const cutModel = model.subtract(cutBox);

console.log("  Housing cut:", cutHousing.numVert(), cutHousing.numTri());
console.log("  Slips cut:", cutSlips.numVert(), cutSlips.numTri());
console.log("  Sleeve cut:", cutSleeve.numVert(), cutSleeve.numTri());

function exportGeo(manifold: any, varName: string): string {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;
  const pos: number[] = [];
  for (let i = 0; i < nv; i++) pos.push(vp[i * np], vp[i * np + 1], vp[i * np + 2]);
  return `export const ${varName}_pos = new Float32Array([${pos.join(",")}]);\nexport const ${varName}_idx = new Uint32Array([${Array.from(tri).join(",")}]);`;
}

// Export cut housing with vertex colors: red outer, grey cut/bore
function exportCutHousingVC(manifold: any): string {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  const nv = vp.length / np;
  const nt = tri.length / 3;
  const h = params.housing;

  const pos: number[] = [];
  for (let i = 0; i < nv; i++) pos.push(vp[i*np], vp[i*np+1], vp[i*np+2]);

  const outPos: number[] = [];
  const outCol: number[] = [];

  for (let i = 0; i < nt; i++) {
    const a = tri[i*3], b = tri[i*3+1], c = tri[i*3+2];
    const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
    const bx = pos[b*3], by = pos[b*3+1], bz = pos[b*3+2];
    const cx = pos[c*3], cy = pos[c*3+1], cz = pos[c*3+2];

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

    outPos.push(ax,ay,az,bx,by,bz,cx,cy,cz);
    outCol.push(r,g,b2,r,g,b2,r,g,b2);
  }

  return `export const housing_cut_vc_pos = new Float32Array([${outPos.join(",")}]);\nexport const housing_cut_vc_col = new Float32Array([${outCol.join(",")}]);`;
}

const dir = "/Users/neerajsethi/duplicate/BOTTOM_SUB/manifold";
const js = [
  exportGeo(housing, "housing_full"),
  exportGeo(slips, "slips_full"),
  exportGeo(sleeve, "sleeve_full"),
  exportGeo(cutHousing, "housing_cut"),
  exportGeo(cutSlips, "slips_cut"),
  exportGeo(cutSleeve, "sleeve_cut"),
  exportCutHousingVC(cutHousing),
  exportGeo(model, "full"),
].join("\n");

Bun.write(`${dir}/geometry.js`, `// ManifoldCAD Parametric Bottom Sub — Separate Components\n${js}\n`);
Bun.write(`${dir}/params.json`, JSON.stringify(params, null, 2));
console.log("geometry.js + params.json exported!");
