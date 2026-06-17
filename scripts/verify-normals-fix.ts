// Verify the 3→0 fix end-to-end through finalizeManifold (the real bake path).
import { initManifold } from '../src/lib/cad/manifold-helpers';
import { revolveProfile, weldAndBuild } from '../src/lib/cad/manifold-mesh';
import { finalizeManifold } from '../src/lib/cad/builder';

await initManifold();
const profile: [number, number][] = [[0, 0], [1, 0], [1, 3], [0, 3]];
const m = weldAndBuild([revolveProfile(profile, 12)]);
const r: any = finalizeManifold(m, 2);
const nrm = r.full.getAttribute('normal').array as Float32Array;
let zero = 0, nonzero = 0;
for (let i = 0; i < nrm.length; i += 3) {
  (Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) < 1e-6) ? zero++ : nonzero++;
}
const tris = r.full.index ? r.full.index.count / 3 : nrm.length / 9;
console.log(`baked full mesh: ${tris} tris (NOT inflated — normals only)`);
console.log(`normals: ${nonzero} non-zero / ${zero} zero  (sample ${[nrm[0].toFixed(2), nrm[1].toFixed(2), nrm[2].toFixed(2)]})`);
