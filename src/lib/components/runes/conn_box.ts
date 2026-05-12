import { geom as taperedConeGeom } from './tapered_cone';
import { tube, mv } from '../manifold-helpers';

export const meta = {
  id: 'conn_box',
  name: 'box_conn',
  description: '',
  tags: [],
  // Params are grouped by `group` — the Inspector's Params tab renders
  // each group as its own tab so the user can focus on one component
  // at a time. Body + Cone are the two sub-pieces composed into the
  // final box connection.
  params: {
    body_od:     { group: 'Body', label: 'OD',     min: 0.5,  max: 6,  step: 0.1,  unit: 'in', default: 2.0 },
    body_wall:   { group: 'Body', label: 'Wall',   min: 0.05, max: 1,  step: 0.05, unit: 'in', default: 0.2 },
    body_length: { group: 'Body', label: 'Length', min: 0.5,  max: 15, step: 0.1,  unit: 'in', default: 4.0 },

    cone_top_od: { group: 'Cone', label: 'Top OD (upset)', min: 0.5,  max: 8,  step: 0.05, unit: 'in', default: 2.9 },
    cone_wall:   { group: 'Cone', label: 'Wall',           min: 0.05, max: 1,  step: 0.05, unit: 'in', default: 0.2 },
    cone_length: { group: 'Cone', label: 'Length',         min: 0.2,  max: 6,  step: 0.1,  unit: 'in', default: 1.5 },
  },
  // Derived params — computed before geom runs, merged into the params
  // bag, surfaced read-only in the Params tab.
  //  - body_id        : bore of the body tube
  //  - cone_bottom_od : the cone's BOTTOM OD is by definition the body OD
  //                     (the join must be flush — there's no separate
  //                     slider for it). Mirroring it as derived keeps
  //                     them locked together.
  //  - upset_ratio    : convenience metric — how much wider the upset is
  //                     vs the body.
  //  - total_length   : body_length + cone_length.
  derived: {
    body_id:        { label: 'Body bore ID',  unit: 'in', from: (p) => p.body_od - 2 * p.body_wall },
    cone_bottom_od: { label: 'Cone bottom OD', unit: 'in', from: (p) => p.body_od },
    upset_ratio:    { label: 'Upset ratio',   unit: '×',  from: (p) => p.cone_top_od / p.body_od },
    total_length:   { label: 'Total length',  unit: 'in', from: (p) => p.body_length + p.cone_length },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.body_wall * 2 >= p.body_od) errs.push('body wall too thick');
    if (p.cone_wall * 2 >= p.cone_top_od) errs.push('cone wall too thick at top');
    if (p.cone_top_od < p.body_od) errs.push('cone top OD should be ≥ body OD (otherwise no upset)');
    return errs;
  },
} as const;

export const geom = (p: Record<string, number>) => {
  // p.body_id, p.cone_bottom_od, etc. are populated by resolveDerived()
  // before this function runs — declared in meta.derived above.

  // Upset cone at the TOP (z = 0 .. cone_length). Z-down rule: top = lower z.
  // WIDE end at z=0 (the upset / box-flange OD = cone_top_od), narrows
  // DOWN to meet the body OD flush at z = cone_length.
  const cone = taperedConeGeom({
    od:     p.cone_bottom_od,  // derived: == body_od (flush join)
    odTop:  p.cone_top_od,     // user slider: the upset OD at top
    wall:   p.cone_wall,
    length: p.cone_length,
  });

  // Body cylinder BELOW the cone. tube() is centered at z=0, so we
  // translate by [0, 0, cone_length + body_length/2] to put its top edge
  // at z = cone_length — flush with the bottom of the cone.
  const body = mv(
    tube(p.body_od / 2, p.body_id / 2, p.body_length),
    [0, 0, p.cone_length + p.body_length / 2],
  );

  return cone.add(body);
};
