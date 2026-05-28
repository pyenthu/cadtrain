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

export interface ProfileTemplate {
  id: string;
  label: string;
  /** Inline-slot body — calc lines + `const profile_pts = ARRAY` (no trailing `;`). */
  body: string;
  tags?: string[];
}

export const CARTESIAN_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'rect',
    label: 'Rect',
    tags: ['rectangle', 'box', 'square'],
    body:
`  const w = p.w ?? 1;
  const h = p.h ?? 0.6;
  const profile_pts = [
    [-w / 2, -h / 2],
    [ w / 2, -h / 2],
    [ w / 2,  h / 2],
    [-w / 2,  h / 2],
  ]`,
  },
  {
    id: 'ngon',
    label: 'Polygon (n-gon)',
    tags: ['hex', 'pentagon', 'octagon', 'nut'],
    body:
`  const n = p.n ?? 6;
  const r = p.r ?? 0.5;
  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'ellipse',
    label: 'Ellipse / Circle',
    tags: ['circle', 'round', 'disc', 'oval'],
    body:
`  const rx = p.rx ?? 1;
  const ry = p.ry ?? 1;
  const n = p.segments ?? 48;
  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    return [cos(a) * rx, sin(a) * ry];
  })`,
  },
  {
    id: 'star',
    label: 'Star',
    tags: ['star', 'spline', 'alternating'],
    body:
`  const points = p.points ?? 5;
  const rOuter = p.rOuter ?? 0.7;
  const rInner = p.rInner ?? 0.3;
  const n = points * 2;
  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    const r = i % 2 === 0 ? rOuter : rInner;
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'gear',
    label: 'Gear (sinusoidal)',
    tags: ['gear', 'teeth', 'cam'],
    body:
`  const teeth = p.teeth ?? 12;
  const rBase = p.rBase ?? 0.5;
  const amp = p.amp ?? 0.08;
  const n = p.segments ?? 96;
  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    const r = rBase + amp * cos(teeth * a);
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'l',
    label: 'L-bracket',
    tags: ['angle iron', 'bracket'],
    body:
`  const legX = p.legX ?? 0.6;
  const legY = p.legY ?? 0.6;
  const t = p.t ?? 0.2;
  const profile_pts = [
    [0, 0],
    [legX, 0],
    [legX, t],
    [t, t],
    [t, legY],
    [0, legY],
  ]`,
  },
  {
    id: 'plus',
    label: 'Plus / Cross',
    tags: ['cross', 'plus'],
    body:
`  const arm = p.arm ?? 0.5;
  const t = p.t ?? 0.25;
  const profile_pts = [
    [-t, -arm], [ t, -arm], [ t, -t], [ arm, -t],
    [ arm,  t], [ t,  t], [ t,  arm], [-t,  arm],
    [-t,  t], [-arm,  t], [-arm, -t], [-t, -t],
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
