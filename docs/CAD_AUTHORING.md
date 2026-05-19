# cadtrain — CAD primitive authoring guide

> Reference for any AI (Claude, local LLM, GPT-class model) authoring or
> editing a primitive under `<volume>/primitives/<id>/`. Attach this file
> to your prompt when generating or refining `source.ts`. Updated
> incrementally as we discover patterns.

## What a primitive is

A primitive is a self-contained directory under `<volume>/primitives/<id>/`
containing exactly **one file** today: `source.ts`. The source exports
a `meta` block (params schema + appearance) and a function that builds
a `Manifold` from those params.

```ts
// <volume>/primitives/warp_ribbon/source.ts
export const meta = {
  id: 'warp_ribbon',
  name: 'warp_ribbon',
  description: 'Helical ribbon — long rectangular strip warped around the Z axis.',
  tags: ['extrude', 'helix'],
  params: {
    radius: { label: 'radius', min: 0.2, max: 10, step: 0.1, default: 2 },
    // ... see Param types section below
  },
  material: {
    outer: { color: '#c97a3f', metallic: 0.3, roughness: 0.6 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

/** @part Helical ribbon — extrude profile along its unrolled arc length, refine, warp into helix coords. */
export function warp_ribbon(
  radius: number,
  /* other params in the SAME ORDER as meta.params keys */
): any {
  // ... build manifold
  return m;
}
```

**Crucial invariants**:

- `meta.params` key order MUST match the function-signature arg order. The dispatch pipes positional args.
- The function name does NOT need to match the directory id (sandbox falls back to first export). But matching helps readability.
- Source.ts is the **single source of truth** — no separate `meta.json`. (Legacy `meta.json` files are ignored when source-embedded meta is present.)

## Param types

| `type` | Storage | UI control | Function receives |
|---|---|---|---|
| `'number'` (default) | `number` | Slider + number input | `number` (positional) |
| `'boolean'` | `0` or `1` | Checkbox | `number` 0/1 (positional) |
| `'polygon'` | `[[x,y], ...]` | SVG canvas in Profile tab | JSON-encoded **string** (parse inside) |

Polygon param body usage:

```ts
let pts: [number, number][];
try { pts = JSON.parse(profileJson); }
catch { throw new Error(`profile not valid JSON: ${profileJson}`); }
if (!Array.isArray(pts) || pts.length < 3) {
  throw new Error('profile must be ≥3 [x,y] vertices');
}
```

## Apply / Save contract

The UI separates **applying values to the runtime preview** from **persisting them as new defaults in source.ts**.

| Action | What changes |
|---|---|
| Drag a slider / edit a textarea / move a polygon vert | Pending edit (orange-bar state); nothing saved |
| Hit Enter / click **Apply** | Pending → applied (runtime); preview re-renders; `source.ts` untouched |
| Click **Save defaults** | Current applied values rewrite the `default:` literals in `source.ts` |
| Click **Save source** | Current editor buffer overwrites `source.ts` |

Never silently mutate `source.ts` on slider drag. Promote runtime values to source defaults only on explicit user action.

## Available helpers + Manifold APIs

Inside the function body, the sandbox provides:

- `M` — the global Manifold class (via Proxy, always pointing at the live wasm singleton). Use static methods: `M.cube`, `M.cylinder`, `M.union(a, b)`.
- Bundle helpers: `cyl(length, r1, r2?)`, `tube(outerR, innerR, length)`, `helix_band(od, length, tpi, depth, profile, taper)`, `revolve(contourJson)`, `profile_extrude(height, twistDegrees, scaleTop, sides)`.
- Operators: `mv(part, [x,y,z])`, `rot(part, [x,y,z])`.
- `G` — `globalThis`. The Manifold wasm singleton sits at `G.__cadtrain_manifold__.wasm`. Access `CrossSection` etc. from there.
- `Math` — full standard library.
- `empty()` — degenerate zero-volume Manifold (use as initial accumulator if needed).
- `initManifold`, `setCircularSegmentMode`, `getCutBox`, `CIRCULAR_SEGMENTS_DEFAULT`, `CIRCULAR_SEGMENTS_COMPOSE`.

The function MUST return a Manifold (an object with `.getMesh()`). Return early with `throw new Error(...)` on bad input.

## Z-down convention (drilling)

- **`top` = LOWER z; `bottom` = HIGHER z.** As z increases you go DOWN the hole.
- `mv(part, [0, 0, +N])` translates DOWN.
- Camera default: `position={[6, 0, 0]}`, `up={[0, 0, -1]}`.

## Manifold gotchas — read before authoring

### 1. `CrossSection.extrude(...).warp(...)` — scaleTop must be Vec2

```ts
// WRONG — scalar 1 silently collapses top profile after warp:
let m = new CS([profile]).extrude(L, seg, 0, 1).warp(...);

// RIGHT — Vec2 identity:
let m = new CS([profile]).extrude(L, seg, 0, [1, 1]).warp(...);
```

Empirically (manifold-3d 3.4.1): scalar `scaleTop=1` combined with a subsequent `.warp()` loses the top-slice y-extent. Symptom: a wedge-tapered top regardless of warp logic. Without warp, both forms produce identical geometry — the bug only surfaces in the combination. Always use `[1, 1]` when warp follows.

### 2. `Manifold.warp` callback receives a Vec3 tuple, not an `{x,y,z}` object

```ts
// WRONG — mutations to .x/.y/.z don't propagate:
m.warp((p) => { p.x = 2*p.x; });

// RIGHT — index access on the tuple:
m.warp((p: [number, number, number]) => {
  p[0] = 2 * p[0];
  p[1] = ...;
  p[2] = ...;
});
```

### 3. `warp`, `refine`, `subtract`, `union` — all immutable, all return a new Manifold

```ts
// WRONG — return value discarded:
m.warp(fn);
m.refine(2);
return m;

// RIGHT — reassign:
m = m.warp(fn);
m = m.refine(2);
return m;
```

### 4. `refine(n)` blows up vertex count fast

`refine(n)` subdivides every edge into n pieces; each triangle becomes n² sub-triangles. With n > ~20 you can produce meshes whose serialized JSON exceeds V8's max string length (~500MB). Symptom: dev server hangs, `RangeError: Invalid string length`.

- Cap `refine` at **≤ 4** in primitive sliders unless you really need it.
- For path resolution prefer `extrude(L, segments, 0, [1,1])` — `segments` scales linearly.

### 5. `getCutBox()` — don't module-cache wasm-bound Manifolds

The cutBox used for the cutaway view used to be cached in a module-local variable. Vite SSR HMR rebuilds the module → cached Manifold class identity goes stale → embind throws `Expected null or instance of Manifold, got an instance of Manifold` on the next `subtract`. Fix: rebuild every call. (Already fixed in `src/lib/cad/manifold-helpers.ts:getCutBox`, but if you write similar caches elsewhere, don't.)

### 6. `CrossSection.extrude` does NOT take an arbitrary 3D path

Only straight-Z extrusion with optional twist + scaleTop. To extrude along a path:

- **Use `warp` after a tall thin prism + `refine`.** Build the prism along Z by the unrolled arc length, refine to give warp enough vertices, then warp every vertex into the target path's coords. See `profile_extrude_v3..v6` for the pattern.
- **Alternative: many-wedges union.** Place a thin slab at each path sample, rotate to the tangent frame, union them all. See `helix_band` in `manifold-helpers.ts`. Slower; works without refine.

## Defensive coding patterns

- **Clamp every numeric input.** `const r = Math.max(0.1, radius);` Sliders can hit 0 / negatives via the number input or formula.
- **Guard the wasm init.** `if (!G.__cadtrain_manifold__.wasm) throw new Error('manifold not initialised — call initManifold() first');`
- **Validate polygon params.** Parse + check length + check structure before passing to `CrossSection`.

## Visual debugging without a browser

Bbox via curl + jq is the fastest sanity check on geometry:

```sh
SRC=$(jq -Rs . < primitives/MY_ID/source.ts)
curl -s -X POST http://localhost:3333/api/primitives/preview \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"MY_ID\",\"name\":\"MY_FN\",\"source\":$SRC,\"params\":[...]}" \
  | jq -r '
    .full.positions as $p | ($p|length) as $n
    | "verts=\($n/3) x: \([$p[range(0;$n;3)]]|min)..\([$p[range(0;$n;3)]]|max) z: \([$p[range(2;$n;3)]]|min)..\([$p[range(2;$n;3)]]|max)"
  '
```

If bbox is symmetric/expected → mesh data is fine; any visual issue is rendering. If asymmetric/clipped → geometry bug. Compare bboxes across param changes to confirm a parameter actually mutates the shape.

## Material block (PBR baked into GLB)

```ts
material: {
  outer: { color: '#cc6644', metallic: 0.3, roughness: 0.55 },
  inner: { color: '#3a4a55', metallic: 0.1, roughness: 0.85 },
}
```

The bake-preview endpoint splits triangles into outer/inner buckets (radial-outward normals → outer; bore-facing → inner) and assigns each its PBR material in the GLB. Downloaded GLB renders correctly in any glTF viewer — Blender, manifoldcad.org/model-viewer.

## Common patterns

### Path extrusion (helix)

```ts
const L = turns * 2 * Math.PI * radius;        // unrolled arc length
let m = new CS([profile]).extrude(L, segments, 0, [1, 1]);  // NOT `, 1`
if (refine > 1) m = m.refine(refine);
m = m.warp((p) => {
  const u = p[2] / L;
  const theta = u * turns * 2 * Math.PI;
  const rOut = radius + p[0];
  p[0] = rOut * Math.cos(theta);
  p[1] = rOut * Math.sin(theta);
  p[2] = u * totalAxial + p[1];   // beware: p[1] used after p[0] but BEFORE p[1] is overwritten
});
return m;
```

### Composite

```ts
let geom = empty();
geom = M.union(geom, cyl(p.length, p.od / 2));   // body
geom = geom.subtract(cyl(p.length + 0.01, p.id / 2));  // bore
return geom;
```

## Anti-patterns — DO NOT

- Don't cache a Manifold result in module scope (Vite SSR HMR breaks embind identity).
- Don't `Number(p)` a polygon arg — they arrive as JSON strings.
- Don't call `m.refine(0)` or `m.refine(1)` thinking it's a no-op — `refine` requires `n > 1`. Guard with `if (n > 1)`.
- Don't omit `[1, 1]` from a Vec2-expecting position. The type system permits the scalar; the runtime doesn't always.
- Don't return without assigning the result of an immutable Manifold op.

## Where to look next

- Existing primitives in `<volume>/primitives/` — copy a v5 / v6 as a starting point. Same shape.
- Bundle primitives at `src/lib/cad/components/*.ts` — git-tracked, more elaborate (validate functions, family classification).
- `src/lib/cad/CLAUDE.md` — domain rules including the gotchas above.
- `src/lib/cad/manifold-helpers.ts` — the helper toolkit; read it to discover what's available.
- `~/.claude/projects/-Users-neerajsethi-code-cadtrain/memory/*.md` — lessons from prior sessions.
