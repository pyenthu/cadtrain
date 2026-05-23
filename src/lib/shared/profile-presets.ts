// Central, extensible registry of PARAMETRIC profile kinds + the resolver that
// turns a stored profile descriptor into a polygon. See
// docs/plans/profile-system.md.
//
// A profile in a primitive's source can be stored as one of:
//   { kind, params }   parametric — regenerated at build from a registry kind
//   { points }         detached / hand-drawn custom polygon
//   [[x,y], ...]       legacy bare array (treated as { points })
//
// resolveProfile(descriptor) collapses all three to a Pt[] polygon. It is pure
// + synchronous + dependency-free so it can be injected into the primitive
// sandbox scope (the single reach-everywhere hook — see the plan's "Refined
// implementation"). Volume-stored / custom-function kinds (P2/P3) are resolved
// one level up in the endpoint before dispatch.

export type Pt = [number, number];

/** A profile slot's stored value. */
export type ProfileDescriptor =
  | Pt[] // legacy bare polygon
  | { points: Pt[]; _gen?: { kind: string; params: Record<string, number> } } // detached (optionally re-linkable)
  | { kind: string; params: Record<string, number> }; // parametric

export interface ProfileParamSpec {
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface ProfileDef {
  id: string;
  label: string;
  set: 'cartesian' | 'revolve';
  tags: string[];
  params: Record<string, ProfileParamSpec>;
  /** params → polygon points (in local profile space). */
  build: (p: Record<string, number>) => Pt[];
}

const P = (label: string, def: number, min: number, max: number, step: number, unit?: string): ProfileParamSpec =>
  ({ label, default: def, min, max, step, unit });

function ngonPts(n: number, r: number, rot = 0): Pt[] {
  const N = Math.max(3, Math.round(n));
  return Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2 + rot;
    return [r * Math.cos(a), r * Math.sin(a)] as Pt;
  });
}

// The seed registry. Cartesian kinds are centred cross-sections for extrusion;
// revolve kinds are r≥0 half-sections (Z-down: z grows downward) for a lathe.
// Defaults reproduce the original hardcoded ProfileEditor presets byte-for-byte
// so picking a kind matches the old preset buttons.
export const PROFILE_REGISTRY: Record<string, ProfileDef> = {
  rect: {
    id: 'rect', label: 'Rect', set: 'cartesian', tags: ['rectangle', 'bar', 'box', 'square'],
    params: { w: P('width', 1, 0.05, 20, 0.05), h: P('height', 0.6, 0.05, 20, 0.05) },
    build: (p) => [[-p.w / 2, -p.h / 2], [p.w / 2, -p.h / 2], [p.w / 2, p.h / 2], [-p.w / 2, p.h / 2]],
  },
  ellipse: {
    id: 'ellipse', label: 'Ellipse / Circle', set: 'cartesian', tags: ['circle', 'round', 'disc', 'oval'],
    params: {
      segments: P('segments', 24, 3, 256, 1),
      rMajor: P('rMajor', 0.5, 0.02, 20, 0.02),
      rMinor: P('rMinor', 0.5, 0.02, 20, 0.02),
    },
    build: (p) => {
      const n = Math.max(3, Math.round(p.segments));
      return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return [p.rMajor * Math.cos(a), p.rMinor * Math.sin(a)] as Pt;
      });
    },
  },
  ngon: {
    id: 'ngon', label: 'Polygon (n-gon)', set: 'cartesian', tags: ['hex', 'hexagon', 'pentagon', 'octagon', 'nut', 'bolt'],
    params: { n: P('sides', 6, 3, 24, 1), r: P('radius', 0.5, 0.02, 20, 0.02) },
    build: (p) => ngonPts(p.n, p.r),
  },
  l: {
    id: 'l', label: 'L-bracket', set: 'cartesian', tags: ['angle', 'bracket', 'ell'],
    params: { legX: P('legX', 0.6, 0.05, 20, 0.05), legY: P('legY', 0.6, 0.05, 20, 0.05), t: P('thickness', 0.2, 0.02, 10, 0.02) },
    build: (p) => [[0, 0], [p.legX, 0], [p.legX, p.t], [p.t, p.t], [p.t, p.legY], [0, p.legY]],
  },
  t: {
    id: 't', label: 'T-section', set: 'cartesian', tags: ['tee'],
    params: {
      w: P('width', 1, 0.1, 20, 0.05), flange: P('flange', 0.2, 0.02, 10, 0.02),
      web: P('web', 0.2, 0.02, 10, 0.02), height: P('height', 0.8, 0.1, 20, 0.05),
    },
    build: (p) => {
      const hw = p.w / 2, top = 0.3, barBot = top - p.flange, hweb = p.web / 2, bot = top - p.height;
      return [[-hw, top], [hw, top], [hw, barBot], [hweb, barBot], [hweb, bot], [-hweb, bot], [-hweb, barBot], [-hw, barBot]];
    },
  },
  plus: {
    id: 'plus', label: 'Plus / Cross', set: 'cartesian', tags: ['cross', 'plus'],
    params: { arm: P('armLength', 0.5, 0.1, 20, 0.05), t: P('thickness', 0.3, 0.05, 10, 0.02) },
    build: (p) => {
      const a = p.arm, h = p.t / 2;
      return [[a, -h], [a, h], [h, h], [h, a], [-h, a], [-h, h], [-a, h], [-a, -h], [-h, -h], [-h, -a], [h, -a], [h, -h]];
    },
  },
  star: {
    id: 'star', label: 'Star', set: 'cartesian', tags: ['star', 'spline'],
    params: { points: P('points', 5, 3, 16, 1), rOuter: P('rOuter', 0.5, 0.05, 20, 0.05), rInner: P('rInner', 0.2, 0.02, 20, 0.02) },
    build: (p) => {
      const N = Math.max(3, Math.round(p.points)), out: Pt[] = [];
      for (let i = 0; i < N * 2; i++) {
        const a = (i / (N * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? p.rOuter : p.rInner;
        out.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return out;
    },
  },
  cylinder: {
    id: 'cylinder', label: 'Cylinder', set: 'revolve', tags: ['rod', 'shaft', 'solid'],
    params: { r: P('radius', 1.2, 0.05, 20, 0.05), len: P('length', 3, 0.1, 40, 0.1) },
    build: (p) => [[0, 0], [p.r, 0], [p.r, p.len], [0, p.len]],
  },
  tube: {
    id: 'tube', label: 'Tube', set: 'revolve', tags: ['pipe', 'hollow', 'bore', 'annulus'],
    params: { ri: P('innerR', 0.7, 0.02, 20, 0.02), ro: P('outerR', 1.2, 0.05, 20, 0.05), len: P('length', 3, 0.1, 40, 0.1) },
    build: (p) => [[p.ri, 0], [p.ro, 0], [p.ro, p.len], [p.ri, p.len]],
  },
  cone: {
    id: 'cone', label: 'Cone', set: 'revolve', tags: ['taper', 'point'],
    params: { r: P('baseR', 1.4, 0.05, 20, 0.05), len: P('length', 3, 0.1, 40, 0.1) },
    build: (p) => [[0, 0], [p.r, p.len], [0, p.len]],
  },
  barrel: {
    id: 'barrel', label: 'Barrel', set: 'revolve', tags: ['drum', 'bulge'],
    params: { rEnd: P('endR', 1.0, 0.05, 20, 0.05), rMid: P('midR', 1.4, 0.05, 20, 0.05), len: P('length', 3, 0.1, 40, 0.1) },
    build: (p) => [[0, 0], [p.rEnd, 0], [p.rMid, p.len / 2], [p.rEnd, p.len], [0, p.len]],
  },
};

export function defaultsFor(def: ProfileDef): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k in def.params) o[k] = def.params[k].default;
  return o;
}

/** Collapse any stored descriptor to a polygon. Pure + sync. Throws on an
 *  unknown kind so callers (sandbox / endpoint) can surface a friendly error. */
export function resolveProfile(d: ProfileDescriptor): Pt[] {
  if (Array.isArray(d)) return d as Pt[];
  if (d && typeof d === 'object' && 'points' in d && Array.isArray((d as any).points)) return (d as any).points as Pt[];
  if (d && typeof d === 'object' && 'kind' in d) {
    const def = PROFILE_REGISTRY[(d as any).kind];
    if (!def) throw new Error(`unknown profile kind "${(d as any).kind}"`);
    return def.build({ ...defaultsFor(def), ...((d as any).params ?? {}) });
  }
  throw new Error('invalid profile descriptor');
}
