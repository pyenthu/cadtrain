/**
 * Baker permanent packer parametric builder (PORTED from SVTC
 * `src/lib/apps/wson/threeD/parametric/bakerPacker.ts`). The one worked example
 * of the ParametricComponent interface — a stand-in until cadtrain's real `g_*`
 * volume parts (see `../../registry.ts`) implement the interface.
 *
 * Geometry recipe:
 *
 *     +---------------+         <- top of upper slip ring
 *     |   slip ring   |
 *     +-------+-------+
 *             |   neck
 *     +-------+-------+         <- start of seal element
 *     |  seal element |  (flared OD = packer OD)
 *     +-------+-------+
 *             |   neck
 *     +---------------+
 *     |   slip ring   |         <- bottom of lower slip ring
 *     +---------------+
 *
 * Local frame: body axis = +Z, centred on origin → spans z ∈ [-L/2, +L/2].
 */
import { initManifold, isManifoldReady } from '../manifoldCut';
import {
  type ParametricComponent,
  manifoldToBufferGeometry,
} from './ParametricComponent';

export const bakerPacker: ParametricComponent = {
  id: 'baker-permanent-packer',
  name: 'Baker Permanent Packer',
  toolCompCodes: [
    'PACKERS.PACKER_BAKER_PERMANENT',
    'PACKERS.PACKER_BAKER',                 // alias seen in legacy files
  ],
  params: [
    { key: 'od',             label: 'OD',          min: 2.5,  max: 9.625, step: 0.125, default: 5,
      description: 'Outer diameter of the packer body / slip rings (in.)' },
    { key: 'id',             label: 'Bore ID',     min: 1.5,  max: 6.0,   step: 0.125, default: 2.0,
      description: 'Through-bore inner diameter for tubing passage (in.)' },
    { key: 'length',         label: 'Length',      min: 0.3,  max: 3.0,   step: 0.05,  default: 0.6,
      description: 'Axial length, including slips + seal stack (m, scaled to packer body)' },
    { key: 'slipRingCount',  label: 'Slip rings',  min: 2,    max: 3,     step: 1,     default: 2,
      description: 'Number of slip rings (2 = top + bottom; 3 adds a central one at the seal core)' },
  ],
  async build(params) {
    if (!isManifoldReady()) await initManifold();
    const wasm: any = await initManifold();
    const { Manifold } = wasm;

    const od    = params.od            ?? 5;
    const id    = params.id            ?? 2;
    const length = params.length       ?? 0.6;
    const ringCount = Math.round(params.slipRingCount ?? 2);

    const sealR    = od / 2;
    const slipR    = od / 2 * 0.95;
    const neckR    = od / 2 * 0.35;
    const boreR    = id / 2;

    const slipLen = length * 0.20;
    const sealLen = length * 0.36;
    const neckLen = length * 0.20;

    // Stack from bottom: lower slip → neck → seal stack → neck → upper slip
    let z = -length / 2;

    let body = Manifold.cylinder(slipLen, slipR, slipR, 64).translate([0, 0, z]);
    z += slipLen;
    body = body.add(Manifold.cylinder(neckLen, neckR, neckR, 32).translate([0, 0, z]));
    z += neckLen;
    if (ringCount >= 3) {
      // Central ring at the seal-stack core.
      const ringHalf = sealLen * 0.20;
      body = body.add(Manifold.cylinder(ringHalf * 2, slipR, slipR, 64)
                              .translate([0, 0, z + sealLen / 2 - ringHalf]));
    }
    body = body.add(Manifold.cylinder(sealLen, sealR, sealR, 64).translate([0, 0, z]));
    z += sealLen;
    body = body.add(Manifold.cylinder(neckLen, neckR, neckR, 32).translate([0, 0, z]));
    z += neckLen;
    body = body.add(Manifold.cylinder(slipLen, slipR, slipR, 64).translate([0, 0, z]));

    // Through-bore — slightly longer than the body so the subtract is clean.
    const bore = Manifold.cylinder(length + 0.02, boreR, boreR, 32)
                          .translate([0, 0, -length / 2 - 0.01]);
    const solid = body.subtract(bore);

    const geometry = manifoldToBufferGeometry(solid);
    return {
      geometry,
      bbox: geometry.boundingBox!.clone(),
      isManifold: true,
      notes: `Baker permanent packer — OD ${od}", bore ${id}", L ${length}m, ${ringCount} rings`,
    };
  },
};
