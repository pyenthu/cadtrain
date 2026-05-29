/**
 * profile-templates — curated inline-body snippets the predefined-profile
 * picker in ProfileFnEditor scaffolds from. Each template's `body` is the
 * SAME shape composeInlineSlotBody produces: zero or more calc lines + a
 * single `const profile_pts = …;` (no trailing `;` — the source's existing
 * `;` after the slot provides it).
 *
 * Selecting a template in the picker REPLACES the current slot body.
 * Editing freely from there is fine; the user can also "save as new" to
 * persist a custom variant under `primitives/profiles/custom/<id>.{prvl,prex}.ts`
 * (not yet wired — flagged TODO at picker time).
 *
 * Two sets, keyed by the editor's `set` axis:
 *   * cartesian — (x,y) cross-sections for r_weld_extrude / r_extrude
 *   * revolve   — (r,z) half-sections for r_revolve
 */

export interface ProfileParamSchema {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
}

export interface ProfileTemplate {
  id: string;
  label: string;
  /** Inline-slot body — calc lines + `const profile_pts = ARRAY` (no trailing `;`). */
  body: string;
  tags?: string[];
  /** Profile-specific params (NOT the engine params length/twist/divs/taper/
   *  segments — those are owned by the part and preserved across a profile
   *  swap). When the picker fires, the part's meta.params block is rewritten
   *  to (partParams from new template) + (engine params from old part). */
  partParams?: Record<string, ProfileParamSchema>;
}

/** Engine params owned by the part's extrude/revolve engine — preserved
 *  across a profile swap so the user keeps their length/twist/divs values. */
export const ENGINE_PARAM_NAMES = ['length', 'twist', 'divs', 'taper', 'segments'] as const;

export const CARTESIAN_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'rect',
    label: 'Rect',
    tags: ['rectangle', 'box', 'square'],
    partParams: {
      w: { label: 'width',  min: 0.05, max: 20, step: 0.05, default: 1 },
      h: { label: 'height', min: 0.05, max: 20, step: 0.05, default: 0.6 },
    },
    body:
`  const profile_pts = [
    [-p.w / 2, -p.h / 2],
    [ p.w / 2, -p.h / 2],
    [ p.w / 2,  p.h / 2],
    [-p.w / 2,  p.h / 2],
  ]`,
  },
  {
    id: 'ngon',
    label: 'Polygon (n-gon)',
    tags: ['hex', 'pentagon', 'octagon', 'nut'],
    partParams: {
      n: { label: 'sides',  min: 3,    max: 24, step: 1,    default: 6 },
      r: { label: 'radius', min: 0.05, max: 5,  step: 0.05, default: 0.5 },
    },
    body:
`  const profile_pts = Array.from({ length: p.n }, (_, i) => {
    const a = (i / p.n) * 2 * PI;
    return [cos(a) * p.r, sin(a) * p.r];
  })`,
  },
  {
    id: 'ellipse',
    label: 'Ellipse / Circle',
    tags: ['circle', 'round', 'disc', 'oval'],
    partParams: {
      rx: { label: 'rx', min: 0.05, max: 10, step: 0.05, default: 1 },
      ry: { label: 'ry', min: 0.05, max: 10, step: 0.05, default: 1 },
    },
    body:
`  const profile_pts = Array.from({ length: p.segments }, (_, i) => {
    const a = (i / p.segments) * 2 * PI;
    return [cos(a) * p.rx, sin(a) * p.ry];
  })`,
  },
  {
    id: 'star',
    label: 'Star',
    tags: ['star', 'spline', 'alternating'],
    partParams: {
      points: { label: 'points', min: 3,    max: 16, step: 1,    default: 5 },
      rOuter: { label: 'rOuter', min: 0.05, max: 5,  step: 0.05, default: 0.7 },
      rInner: { label: 'rInner', min: 0.02, max: 5,  step: 0.05, default: 0.3 },
    },
    body:
`  const n = p.points * 2;
  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    const r = i % 2 === 0 ? p.rOuter : p.rInner;
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'gear',
    label: 'Gear (sinusoidal)',
    tags: ['gear', 'teeth', 'cam'],
    partParams: {
      teeth: { label: 'teeth',       min: 1,    max: 48,  step: 1,    default: 12 },
      rBase: { label: 'rBase',       min: 0.05, max: 5,   step: 0.05, default: 0.5 },
      amp:   { label: 'tooth depth', min: 0,    max: 0.5, step: 0.01, default: 0.08 },
    },
    body:
`  const profile_pts = Array.from({ length: p.segments }, (_, i) => {
    const a = (i / p.segments) * 2 * PI;
    const r = p.rBase + p.amp * cos(p.teeth * a);
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'l',
    label: 'L-bracket',
    tags: ['angle iron', 'bracket'],
    partParams: {
      legX: { label: 'legX',      min: 0.05, max: 20, step: 0.05, default: 0.6 },
      legY: { label: 'legY',      min: 0.05, max: 20, step: 0.05, default: 0.6 },
      t:    { label: 'thickness', min: 0.02, max: 10, step: 0.02, default: 0.2 },
    },
    body:
`  const profile_pts = [
    [0, 0],
    [p.legX, 0],
    [p.legX, p.t],
    [p.t, p.t],
    [p.t, p.legY],
    [0, p.legY],
  ]`,
  },
  {
    id: 'plus',
    label: 'Plus / Cross',
    tags: ['cross', 'plus'],
    partParams: {
      arm: { label: 'arm',       min: 0.1, max: 20, step: 0.05, default: 0.5 },
      t:   { label: 'thickness', min: 0.05, max: 10, step: 0.02, default: 0.25 },
    },
    body:
`  const profile_pts = [
    [-p.t, -p.arm], [ p.t, -p.arm], [ p.t, -p.t], [ p.arm, -p.t],
    [ p.arm,  p.t], [ p.t,  p.t], [ p.t,  p.arm], [-p.t,  p.arm],
    [-p.t,  p.t], [-p.arm,  p.t], [-p.arm, -p.t], [-p.t, -p.t],
  ]`,
  },
];

export const REVOLVE_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'cylinder',
    label: 'Cylinder',
    tags: ['rod', 'shaft', 'solid'],
    body:
`  const r = p.r ?? 1.0;
  const len = p.length ?? 3;
  const profile_pts = [
    [0, 0],
    [r, 0],
    [r, len],
    [0, len],
  ]`,
  },
  {
    id: 'tube',
    label: 'Tube',
    tags: ['pipe', 'hollow', 'bore', 'annulus'],
    body:
`  const ri = p.id / 2;
  const ro = p.od / 2;
  const len = p.length ?? 3;
  const profile_pts = [
    [ri, 0],
    [ro, 0],
    [ro, len],
    [ri, len],
    [ri, 0],
  ]`,
  },
  {
    id: 'cone',
    label: 'Cone',
    tags: ['taper', 'point'],
    body:
`  const r = p.r ?? 1;
  const len = p.length ?? 3;
  const profile_pts = [
    [0, 0],
    [r, 0],
    [0, len],
  ]`,
  },
  {
    id: 'barrel',
    label: 'Barrel',
    tags: ['drum', 'bulge'],
    body:
`  const rEnd = p.rEnd ?? 1.0;
  const rMid = p.rMid ?? 1.4;
  const len = p.length ?? 3;
  const profile_pts = [
    [0, 0],
    [rEnd, 0],
    [rMid, len / 2],
    [rEnd, len],
    [0, len],
  ]`,
  },
];

export function templatesFor(set: 'cartesian' | 'revolve'): ProfileTemplate[] {
  return set === 'cartesian' ? CARTESIAN_TEMPLATES : REVOLVE_TEMPLATES;
}
