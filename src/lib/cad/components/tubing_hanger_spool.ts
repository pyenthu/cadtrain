import { cyl, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'tubing_hanger_spool',
  name: 'Tubing Hanger Spool',
  description: 'Flanged spool between casing head and Christmas tree. Carries the tubing hanger that suspends the production tubing string. API 6A pressure-rated flanges, central tubing bore + bottom-prep counterbore for the hanger to land in.',
  tags: ['wellhead', 'tubing hanger', 'THS', 'spool', 'flange', 'API 6A'],
  params: {
    length: { label: 'Length', min: 6, max: 24, step: 0.25, unit: 'in', default: 12.0 },
    topFlangeOD: { label: 'Top Flange OD', min: 1.5, max: 8, step: 0.0625, unit: 'in', default: 2.5625 },
    topFlangeThk: { label: 'Top Flange Thk', min: 0.5, max: 3, step: 0.0625, unit: 'in', default: 1.5 },
    bottomFlangeOD: { label: 'Bottom Flange OD', min: 4, max: 14, step: 0.0625, unit: 'in', default: 7.0625 },
    bottomFlangeThk: { label: 'Bottom Flange Thk', min: 0.5, max: 3, step: 0.0625, unit: 'in', default: 1.75 },
    neckOD: { label: 'Neck OD', min: 2, max: 10, step: 0.0625, unit: 'in', default: 4.5 },
    bore: { label: 'Bore', min: 1, max: 6, step: 0.0625, unit: 'in', default: 2.5625 },
    bottomPrepOD: { label: 'Bottom Prep OD', min: 2, max: 8, step: 0.0625, unit: 'in', default: 4.5 },
    bottomPrepDepth: { label: 'Bottom Prep Depth', min: 0.5, max: 4, step: 0.125, unit: 'in', default: 1.75 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const neckLen = Math.max(0.01, p.length - p.topFlangeThk - p.bottomFlangeThk);
  let body = cyl(p.topFlangeThk, p.topFlangeOD / 2);
  body = body.add(mv(cyl(neckLen, p.neckOD / 2), [0, 0, p.topFlangeThk]));
  body = body.add(mv(cyl(p.bottomFlangeThk, p.bottomFlangeOD / 2), [0, 0, p.length - p.bottomFlangeThk]));
  body = body.subtract(mv(cyl(p.length + 0.02, p.bore / 2), [0, 0, -0.01]));
  body = body.subtract(mv(cyl(p.bottomPrepDepth + 0.01, p.bottomPrepOD / 2), [0, 0, p.length - p.bottomPrepDepth]));
  return body;
});
