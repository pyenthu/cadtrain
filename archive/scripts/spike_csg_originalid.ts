/**
 * Phase 0 spike — does Manifold's originalID survive our weld + CSG?
 *
 * Question: after `body.subtract(bore)` / `body.add(threads)`, can we map
 * each OUTPUT triangle back to which source `r_*` part it came from?
 *
 * Tests both:
 *   (1) plain M.cube manifolds (baseline — does CSG track IDs at all?)
 *   (2) weldAndBuild manifolds (our ACTUAL r_* path — fresh new Manifold(Mesh))
 * and both default originalID vs explicit asOriginal().
 *
 *   bun run scripts/spike_csg_originalid.ts
 */
import { initManifold } from '../src/lib/cad/manifold-helpers';
import { revolveProfile, capFan, weldAndBuild, type Patch } from '../src/lib/cad/manifold-mesh';

function wasm() { return (globalThis as any).__cadtrain_manifold__.wasm; }

/** A welded solid cylinder (radius r, height h) — same machinery as r_cylinder. */
function weldCyl(r: number, h: number): any {
  const prof: [number, number][] = [[0, 0], [r, 0], [r, h], [0, h]];
  const side: Patch = revolveProfile(prof, 48);
  return weldAndBuild([side]); // revolveProfile already closes via axis fans
}

function relation(label: string, m: any) {
  const mesh = m.getMesh();
  const triCount = mesh.triVerts.length / 3;
  const runOrig = mesh.runOriginalID ? Array.from(mesh.runOriginalID as Uint32Array) : null;
  const runIdx = mesh.runIndex ? Array.from(mesh.runIndex as Uint32Array) : null;
  const faceID = mesh.faceID ? (mesh.faceID as Uint32Array) : null;
  console.log(`\n── ${label} ──`);
  console.log(`  originalID():     ${m.originalID()}`);
  console.log(`  triangles:        ${triCount}`);
  console.log(`  numProp:          ${mesh.numProp}`);
  console.log(`  runOriginalID:    ${runOrig ? JSON.stringify(runOrig) : '(none)'}`);
  console.log(`  runIndex:         ${runIdx ? JSON.stringify(runIdx) : '(none)'} (÷3 = tri offsets)`);
  console.log(`  faceID present:   ${faceID ? `yes (len ${faceID.length})` : 'no'}`);
  // Per-triangle source: walk runs and attribute every triangle to its run's originalID.
  if (runOrig && runIdx) {
    const triSource = new Int32Array(triCount).fill(-1);
    for (let run = 0; run < runOrig.length; run++) {
      const t0 = runIdx[run] / 3, t1 = runIdx[run + 1] / 3;
      for (let t = t0; t < t1; t++) triSource[t] = runOrig[run];
    }
    const counts = new Map<number, number>();
    for (const s of triSource) counts.set(s, (counts.get(s) ?? 0) + 1);
    console.log(`  → tris per source: ${JSON.stringify([...counts.entries()])}`);
  }
  return { runOrig };
}

async function main() {
  await initManifold();
  const { Manifold } = wasm();

  console.log('============ TEST 1: plain M.cube (baseline) ============');
  const cubeA = Manifold.cube([2, 2, 2], true).asOriginal();
  const cubeB = Manifold.cube([1, 1, 4], true).asOriginal();
  const idA = cubeA.originalID(), idB = cubeB.originalID();
  console.log(`source IDs:  A=${idA}  B=${idB}`);
  const sub = cubeA.subtract(cubeB);
  const r1 = relation('cubeA.subtract(cubeB)', sub);
  const add = cubeA.add(cubeB);
  relation('cubeA.add(cubeB)', add);
  console.log(`\n  ✔ can distinguish A vs B in subtract output: ${r1.runOrig?.includes(idA) && r1.runOrig?.includes(idB)}`);

  console.log('\n\n============ TEST 2: weldAndBuild (our r_* path) ============');
  const body = weldCyl(2, 4);
  const bore = weldCyl(1, 6);
  console.log(`weld default originalID:  body=${body.originalID()}  bore=${bore.originalID()}`);
  const bodyO = body.asOriginal();
  const boreO = bore.asOriginal();
  const wIdBody = bodyO.originalID(), wIdBore = boreO.originalID();
  console.log(`after asOriginal():       body=${wIdBody}  bore=${wIdBore}`);
  const tube = bodyO.subtract(boreO);
  const r2 = relation('weldBody.subtract(weldBore)', tube);
  console.log(`\n  ✔ welded source survives CSG: ${r2.runOrig?.includes(wIdBody) && r2.runOrig?.includes(wIdBore)}`);

  console.log('\n\n============ TEST 3: reserveIDs (explicit unique tags) ============');
  const base = Manifold.reserveIDs(2);
  console.log(`reserveIDs(2) → base=${base} (so ids ${base}, ${base + 1})`);
  // To attach a reserved id we must round-trip through Mesh.runOriginalID.
  const c1 = weldCyl(2, 4);
  const m1 = c1.getMesh();
  m1.runOriginalID = new Uint32Array([base]);
  const c1tagged = new Manifold(m1);
  const c2 = weldCyl(1, 6);
  const m2 = c2.getMesh();
  m2.runOriginalID = new Uint32Array([base + 1]);
  const c2tagged = new Manifold(m2);
  console.log(`tagged originalID: c1=${c1tagged.originalID()}  c2=${c2tagged.originalID()}`);
  const tube2 = c1tagged.subtract(c2tagged);
  relation('tagged subtract', tube2);

  console.log('\n\n============ TEST 4: survives calculateNormals + cutbox (builder path) ============');
  // The builder does: manifold.calculateNormals(3,60).getMesh()  → must keep runOriginalID.
  // And cutVC does:    manifold.subtract(cutBox)                  → an UNTAGGED tool.
  const b2 = weldCyl(2, 4).asOriginal();
  const o2 = weldCyl(1, 6).asOriginal();
  const idBody = b2.originalID(), idO = o2.originalID();
  console.log(`body=${idBody} bore=${idO}`);
  const composed = b2.subtract(o2);
  let withN: any; try { withN = composed.calculateNormals(3, 60); } catch (e) { console.log('calculateNormals threw', e); withN = composed; }
  relation('after calculateNormals(3,60)', withN);
  // Cutaway: subtract a big untagged box covering y<0 (mirrors getCutBox half-cut).
  const cutBox = Manifold.cube([100, 50, 100], true).translate([0, -25, 0]); // untagged tool
  const cut = composed.subtract(cutBox);
  const r4 = relation('after cutbox subtract (untagged tool)', cut);
  console.log(`\n  body/bore still present after cutbox: ${r4.runOrig?.includes(idBody) && r4.runOrig?.includes(idO)}`);
  console.log(`  cutbox introduced a NEW id (the section plane): ${r4.runOrig?.filter(x => x !== idBody && x !== idO)}`);

  console.log('\n\n============ TEST 5: Manifold.compose (instancing — no boolean) ============');
  // The dp_inst_stand path: build a joint ONCE, place translated copies, then
  // combine WITHOUT a boolean union. compose is @deprecated in 3.4.x — confirm
  // it (a) still runs, (b) preserves each body's originalID (color-by-source),
  // (c) leaves them topologically SEPARATE (decompose → N), (d) survives the
  // cutaway subtract. Joints placed end-to-end (touching at z=4), as a real
  // made-up stand would be — NOT fused.
  const ja = weldCyl(2, 4).asOriginal();
  const jb = weldCyl(2, 4).asOriginal().translate([0, 0, 4]); // stacked, touching
  // NOTE: .originalID() reads -1 on jb because .translate() follows .asOriginal()
  // (the accessor de-originals on transform) — but the mesh RELATION keeps the id.
  // Read the preserved id from the relation; that's what color-by-source uses.
  const idJa = ja.originalID();
  const idJb = (jb.getMesh().runOriginalID?.[0] as number) ?? jb.originalID();
  console.log(`ja=${idJa} jb(via relation)=${idJb} (jb.originalID()=${jb.originalID()} — de-originaled by translate)`);
  let comp: any = null;
  try { comp = (Manifold as any).compose([ja, jb]); }
  catch (e) { console.log('  ✗ compose threw:', e); }
  if (comp) {
    const r5 = relation('compose([ja, jb])', comp);
    console.log(`\n  ✔ both joints' ids survive compose: ${r5.runOrig?.includes(idJa) && r5.runOrig?.includes(idJb)}`);
    let nParts = -1; try { nParts = comp.decompose().length; } catch { /* ignore */ }
    console.log(`  decompose() → ${nParts} bodies (expect 2 — separate, not fused)`);
    console.log(`  volume: ${comp.volume().toFixed(2)} (≈ 2× single joint = ${(2 * ja.volume()).toFixed(2)})`);
    const cutBox = Manifold.cube([100, 50, 100], true).translate([0, -25, 0]);
    const cut = comp.subtract(cutBox);
    const r5c = relation('compose → cutbox subtract', cut);
    console.log(`  ✔ ids survive cutaway on composed body: ${r5c.runOrig?.includes(idJa) && r5c.runOrig?.includes(idJb)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
