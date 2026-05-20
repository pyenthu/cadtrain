import Module from 'manifold-3d';

async function main() {
  const wasm = await Module();
  wasm.setup();
  wasm.setCircularSegments(64);
  const { Manifold, Mesh } = wasm;

  // ─── helix_band v1 (union of 192 cubes) ──────────────────────────────
  function helixBandUnion(od:number, length:number, tpi:number, depth:number) {
    const pitch = 1/tpi;
    const numTurns = length*tpi;
    const segmentsPerTurn = 24;
    const totalSegments = Math.max(8, Math.ceil(numTurns*segmentsPerTurn));
    const axialExtent = pitch*0.5;
    let band:any = null;
    for (let i = 0; i < totalSegments; i++) {
      const angleDeg = (i/segmentsPerTurn)*360;
      const z = (i/totalSegments)*length;
      const segArcLen = (2*Math.PI*(od/2))/segmentsPerTurn;
      const tangentialExtent = segArcLen*1.6;
      let tooth = Manifold.cube([depth+0.02, tangentialExtent, axialExtent] as any, false);
      tooth = tooth
        .translate([od/2-depth, -tangentialExtent/2, 0])
        .rotate([0,0,angleDeg])
        .translate([0,0,z]);
      band = band ? Manifold.union(band, tooth) : tooth;
    }
    return band;
  }

  // ─── raw_helix_3 (single triangle soup + caps) ───────────────────────
  function rawHelix3(od:number, length:number, tpi:number, depth:number, axialHalf:number, segmentsPerTurn:number) {
    const D = od, L = length, T = tpi, dep = depth, hAx = axialHalf;
    const spt = segmentsPerTurn;
    const R = D/2;
    const numTurns = T*L;
    const N = Math.max(2, Math.ceil(numTurns*spt));
    function rail(i:number){ const t=i/N, theta=t*numTurns*2*Math.PI, cz=t*L;
      return { cx: R*Math.cos(theta), cy: R*Math.sin(theta), cz, radial:[Math.cos(theta), Math.sin(theta), 0] as [number,number,number] };
    }
    const profile:[number,number][] = [[0,-hAx],[0,hAx],[dep,hAx],[dep,-hAx],[0,-hAx]];
    const uN = N, vN = 4;
    const numV = (uN+1)*(vN+1);
    const verts = new Float32Array(numV*3);
    let p = 0;
    for (let r = 0; r <= uN; r++) {
      const s = rail(r);
      for (let c = 0; c <= vN; c++) {
        const [pr, pa] = profile[c];
        verts[p++] = s.cx + s.radial[0]*pr;
        verts[p++] = s.cy + s.radial[1]*pr;
        verts[p++] = s.cz + pa;
      }
    }
    const tris = new Uint32Array(uN*vN*6);
    let k = 0;
    for (let r = 0; r < uN; r++) {
      for (let c = 0; c < vN; c++) {
        const a = r*(vN+1)+c, b = a+1, d2 = a+(vN+1), e = d2+1;
        tris[k++]=a; tris[k++]=b; tris[k++]=e;
        tris[k++]=a; tris[k++]=e; tris[k++]=d2;
      }
    }
    // weld
    const eps = 1e-6;
    const map = new Map<string, number>();
    const newPos:number[] = [];
    const remap = new Uint32Array(numV);
    for (let n = 0; n < numV; n++) {
      const x=verts[n*3], y=verts[n*3+1], z=verts[n*3+2];
      const key=`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
      let idx = map.get(key);
      if (idx===undefined){ idx=newPos.length/3; newPos.push(x,y,z); map.set(key,idx); }
      remap[n]=idx;
    }
    const newTris = new Uint32Array(tris.length);
    for (let n = 0; n < tris.length; n++) newTris[n]=remap[tris[n]];
    return new Manifold(new Mesh({numProp:3, vertProperties: new Float32Array(newPos), triVerts: newTris} as any));
  }

  // ─── Bench ──────────────────────────────────────────────────────────
  const tube = Manifold.cylinder(4, 2.25, 2.25, 96, false);

  console.log('=== Build band only ===');
  let t = Date.now();
  for (let i = 0; i < 5; i++) helixBandUnion(4.5, 2, 4, 0.1);
  console.log(`helix_band (5×): ${Date.now()-t}ms total`);
  t = Date.now();
  for (let i = 0; i < 5; i++) rawHelix3(4.5, 2, 4, 0.1, 0.05, 24);
  console.log(`raw_helix_3 (5×): ${Date.now()-t}ms total`);

  console.log('\n=== Build + subtract from tube ===');
  t = Date.now();
  const b1 = helixBandUnion(4.5, 2, 4, 0.1);
  console.log(`  union build: ${Date.now()-t}ms`);
  t = Date.now();
  tube.subtract(b1);
  console.log(`  tube.subtract: ${Date.now()-t}ms`);

  t = Date.now();
  const b2 = rawHelix3(4.5, 2, 4, 0.1, 0.05, 24);
  console.log(`  raw build: ${Date.now()-t}ms`);
  t = Date.now();
  tube.subtract(b2);
  console.log(`  tube.subtract: ${Date.now()-t}ms`);

  const m1 = b1.getMesh().triVerts.length/3;
  const m2 = b2.getMesh().triVerts.length/3;
  console.log(`\nTri counts — union band: ${m1}, raw band: ${m2}`);
}
main().catch(e=>{console.error(e); process.exit(1);});
