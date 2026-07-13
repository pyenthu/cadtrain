<!-- research-group: Wells / schematic -->
# SVTC depth auto-scale + DTX (depth-transform) — deep dive

Read-only study of `~/code/SVTC`. Goal: understand SVTC's 2D well-diagram
vertical auto-scale (`yScale`) and the piecewise-linear depth-transform
(`dtx` / `autoNodes`) that locally magnifies short, component-dense intervals
("jewellery") so tiny tools aren't sub-pixel — so cadtrain can adapt it into a
3D along-hole `zScale` + small-section magnifier applied in measured-depth
space **before** warping along the survey spline.

## Source map (verified)

| File | Role |
|---|---|
| `src/routes/api/schematic/+server.js` | `autoNodes()` builds the DTX LUT; `buildSegments()` builds arc trajectory; `action:'autonodes'` returns `{ dtx, prNorm, prAuto }` |
| `src/lib/apps/wson/wsonRender.js` | `_lerpDTX()` lookup, `txPoint()` (the depth→screen map), `WellDirection` arc-warp, `buildDirPath/Side`, `perfArrows` |
| `src/lib/apps/wson/WsonApp.svelte` | `geo = $derived.by` (L630-765): `autoYScale`, `maxDepth`, ruler, helpers. `fetchDirData()` (L1031) builds nodes + calls the API. `scheduleDirRefresh()` debounce |
| `src/lib/apps/wson/Wson2DRenderer.svelte` | draws ruler ticks + shapes via `geo.syD()` / `txPoint` |
| `src/lib/apps/wson/WsonDisplayMenu.svelte` | manual `yScale` slider (0.05–0.50, step 0.025) |

Two coordinate spaces matter throughout: **MD** (measured depth, metres) and
**transformed depth** (`depthTx`, also in "metre-like" units, same 0..maxDepth
range). DTX maps MD→transformed-depth; `yScale` maps transformed-depth→pixels.

---

## 1. yScale / autoYScale (base fit-to-viewport)

`WsonApp.svelte` L682-685:

```js
const maxDepth   = allD.length ? Math.max(...allD) + 50 : 1000; // deepest OH/CH/strata/perf/completion bottom +50 m pad
const autoYScale = Math.min(Math.max(400 / maxDepth, 0.08), 0.35);
const yScale     = displayOpts.autoScale ? autoYScale : displayOpts.yScale;
```

- **Inputs:** only `maxDepth` (deepest feature + 50 m). It does **not** read the
  actual pixel height of the viewport — it targets a *constant* `400 px`
  nominal diagram height (`400/maxDepth` px per metre), then **clamps to
  `[0.08, 0.35]` px/m**. So a 5000 m well → `400/5000 = 0.08` (hits the floor);
  a 1000 m well → `0.35` cap (would be 0.40, capped). Effective auto range of
  diagram height: ~`400 px` in the sweet spot, taller at the floor.
- **Total height** uses it directly (L703):
  `totalH = HEADER_H(100) + (hasDir ? maxTVD : maxDepth) * yScale + 40`.
- **Manual override:** when `autoScale` is off, `yScale = displayOpts.yScale`
  (slider 0.05–0.50). The two do **not** blend — it's a hard switch. There is no
  user multiplier on top of `autoYScale`; auto is fully automatic.
- `diaScale` (radial/diameter px-per-inch) is independent of `yScale` (governs
  X). Inside `txPoint`, the radial offset uses `scR = dS / yS` to convert an
  inch offset into the same warped-metre space as depth so shapes stay attached
  to the (possibly warped) centreline — see §3.

---

## 2. The DTX / autoNodes depth-transform — THE CORE

`+server.js` L128-160. Built **server-side** from a list of `nodes`
(`{start, end}` MD intervals) + `maxDepth`.

### 2a. Data structure

A **piecewise-linear LUT**: two parallel monotone arrays of equal length.

```js
return { depth, depthTx };   // depth[i] = real MD breakpoint, depthTx[i] = transformed depth
```

`depth` starts at `[0]`, `depthTx` at `[0]`; one entry pushed per interval, so
both end at `maxDepth` (because `totalW` normalisation, below, forces
`depthTx[last] == maxDepth`). It is a **monotonic, continuous, piecewise-linear**
map MD → transformed-depth, anchored at `(0,0)` and `(maxDepth, maxDepth)`.

### 2b. Which intervals get magnified (the decision rule)

```js
const breaks = new Set([0, maxDepth]);
for (const nd of nodes) { breaks.add(nd.start); breaks.add(nd.end); }
const bpts = [...breaks].sort((a,b)=>a-b);          // every tool edge is a breakpoint

for (let i=0; i<bpts.length-1; i++) {
  const s=bpts[i], e=bpts[i+1], len=e-s;
  if (len<=0) continue;
  let weight = 1;                                    // default: no magnification
  for (const nd of nodes) {
    if (nd.start<=s && nd.end>=e && len<50) {        // interval FULLY inside a tool AND shorter than 50 m
      const w = 50 / (0.3*len);
      weight = Math.max(weight, isFinite(w)?w:1);
    }
  }
  intervals.push({ s,e,len, w:weight });
}
```

- The full MD axis `[0, maxDepth]` is sliced at **every** tool-interval edge.
- An interval is magnified **only if** (a) it is *entirely contained* in some
  node (`nd.start<=s && nd.end>=e`), i.e. it's inside a tool/completion/perf,
  **and** (b) it is **shorter than the 50 m threshold**. Gaps between tools, and
  any tool longer than 50 m, get `weight = 1` (unmagnified).
- "Density" is implicit: a depth band crowded with several short tools produces
  many short sub-intervals, each individually magnified — the crowding falls out
  of the per-interval rule, there is no explicit density count.
- Nodes are built (`WsonApp.fetchDirData`, L1044-1072) from **completions**
  (`{start:top,end:bot}` or cursor+length) **and perforations**. If none exist a
  single full-depth node `{0, maxDepth}` is added (→ no magnification, identity).

### 2c. The magnification math (and the auto-compensation)

```js
const totalW = intervals.reduce((sum,iv)=> sum + iv.len*iv.w, 0);
let cumReal=0, cumWt=0;
for (const iv of intervals){
  cumReal += iv.len;                         // real MD consumed
  cumWt   += iv.len*iv.w;                     // weighted MD consumed
  depth.push(cumReal);
  depthTx.push(cumWt * maxDepth / totalW);    // renormalised so total span == maxDepth
}
```

Per interval the **local slope** of the transform is
`d(depthTx)/d(MD) = w * maxDepth / totalW`. The key identity that makes this a
"jewellery magnifier":

```
weighted length of a magnified interval = len * w = len * 50/(0.3*len) = 50/0.3 ≈ 166.67
```

**Every magnified short interval contributes a constant 166.67 of weighted
length regardless of its real length.** So each short tool is allocated the
*same* slice of transformed depth — `(166.67 / totalW) * maxDepth` metres of
transformed space, i.e. a guaranteed minimum on-screen footprint of
`(166.67/totalW) * maxDepth * yScale` px. A 2 m nipple and a 10 m sub end up the
same screen height. That is the minimum-pixel-size guarantee.

**Compensation / fit:** the `* maxDepth / totalW` factor renormalises so the
transformed axis still spans exactly `[0, maxDepth]`. Because magnified
intervals inflate `totalW` above `Σlen = maxDepth`, the unmagnified intervals
(slope `maxDepth/totalW < 1`) are **proportionally compressed** to make room.
Total diagram height is therefore unchanged by DTX — only the *distribution*
of pixels changes. (yScale is computed from raw `maxDepth`, not `totalW`, so DTX
never changes overall height.)

Worked micro-example: `maxDepth=1000`, one 10 m tool at 500–510.
Intervals: `[0,500] w1`, `[500,510] w=50/(0.3·10)=16.67`, `[510,1000] w1`.
`totalW = 500 + 10·16.67 + 490 = 1156.7`. The 10 m tool's transformed span =
`10·16.67/1156.7·1000 = 144 m` → at `yScale≈0.35` ≈ **50 px** instead of 3.5 px.

### 2d. Lookup / interpolation

`wsonRender.js` L81-93 (identical copy `lerpDTX` in `+server.js` L187):

```js
function _lerpDTX(d, depth, depthTx){
  if (!depth?.length) return d;
  if (d <= depth[0])    return depthTx[0];          // clamp low
  const last = depth.length-1;
  if (d >= depth[last]) return depthTx[last];        // clamp high
  for (let i=1; i<=last; i++)
    if (d <= depth[i]){
      const t = (d-depth[i-1])/(depth[i]-depth[i-1]);
      return depthTx[i-1] + t*(depthTx[i]-depthTx[i-1]); // linear within segment
    }
}
```

**Monotonic & continuous** (weights ≥ 0, cumulative sums strictly increase for
positive-length intervals). **Reversible in principle** (swap the arrays and lerp
`depthTx → depth`), though SVTC never inverts it — it only ever needs MD→screen,
and the ruler keeps real-MD labels (§4). Out-of-range MD clamps to the endpoints.

---

## 3. Application: real depth (m) → screen-y

`txPoint(xInches, yMD, wellDir, dtx, yS, dS, cX, autoS)` — `wsonRender.js` L96-113.
Every shape (casing, OH, cement, completions, perfs, ruler) routes through it,
usually via `geo.syD(md) = txPoint(0, md, …)[1]` (L711) or `buildDirPath/Side`.

**Straight (vertical) well — `wellDir` has no deviation:**
```js
const yPx = (autoS && dtx) ? _lerpDTX(yMD, dtx.depth, dtx.depthTx) * yS : yMD * yS;
return [cX + xInches*dS, HEADER_H + yPx];
```
So screen-y = `HEADER_H + DTX(MD) * yScale`. DTX warps the depth, yScale scales
it, HEADER_H offsets. X is independent: `centerX + xInches * diaScale`.

**Directional well — `wellDir.hasDeviation`:**
```js
const yW  = autoS && dtx ? _lerpDTX(yMD, dtx.depth, dtx.depthTx) : yMD;  // DTX FIRST
const ctr = wellDir.dirWarp([0, yW]);                                    // then arc-warp
if (xInches===0) return [cX + ctr[0]*yS, HEADER_H + ctr[1]*yS];          // [N, TVD] both *yScale
const perps = wellDir.getPerpendicular2D(yW);
const offM  = Math.abs(xInches * (dS/yS));                               // inch→warped-metre
return [cX + (ctr[0]+perp[0]*offM)*yS, HEADER_H + (ctr[1]+perp[1]*offM)*yS];
```
`dirWarp` returns `[northing, TVD]` in metres; both axes share `yScale`
(isotropic), so a deviated path keeps true shape. Radial thickness is added
along the survey **perpendicular**, scaled by `scR = diaScale/yScale` so it lands
in the same warped-metre space.

Call chain: `geo.syD` / `dirPath` / `dirSide` (in `WsonApp` geo block) →
`txPoint` → `_lerpDTX` (+ `WellDirection.dirWarp` / `getPerpendicular2D`).

---

## 4. Ruler / ticks under a non-linear (DTX-warped) axis

Tick **selection** = "nice" 1/2/5/10×10ⁿ on the **raw** MD range, ≤12 ticks
(`WsonApp.svelte` L742-748) → round real depths (0, 500, 1000…). Tick
**placement** goes through the **same DTX** (`y = geo.syD(d)`,
`Wson2DRenderer.svelte` L112-115): labels stay truthful real-MD, spacing
compresses/expands with the transform (bunched in compressed bands, spread across
magnified tool bands). Directional mode adds a `↕` "MD-along-hole" suffix. No
inverse-DTX pass — the non-uniform spacing IS the magnification signal.

---

## 5. Interaction with the trajectory warp — sequencing (THE KEY QUESTION)

**DTX is applied BEFORE the directional spline warp, in MD space — and
consistently so.** Two reinforcing facts:

1. **Server pre-bakes DTX into the survey** (`+server.js` L186-201). The
   `autonodes` action builds `dtx`, then remaps the survey station MDs through
   the same lerp and rebuilds arc segments from the *remapped* survey:
   ```js
   const autoSurvey = survey.map(p => ({ ...p, md: lerpDTX(p.md ?? 0) }));
   const prAuto     = buildSegments(autoSurvey.length ? autoSurvey : survey, td);
   return json({ dtx, prNorm, prAuto });   // prNorm = raw-MD arcs, prAuto = DTX-MD arcs
   ```
   In auto mode `geo` picks `prAuto` (L660-662), so the `WellDirection` arc model
   **lives entirely in transformed-depth space**.

2. **`txPoint` also lerps MD→DTX before calling `dirWarp`** (`yW = _lerpDTX(yMD)`,
   then `wellDir.dirWarp([0, yW])`). Since `wellDir` is `prAuto` (transformed
   space) and `yW` is transformed, the parameter and the model agree — no
   double-application, no mismatch.

So the pipeline is:

```
raw MD  ──DTX (lerp, MD/straight space)──▶  transformed depth (yW)
        ──directional arc-warp (WellDirection on prAuto)──▶  [northing, TVD] metres
        ──× yScale, + HEADER_H / centerX──▶  screen (x,y)
```

DTX magnification happens **along measured depth, in the straight/un-warped
frame**, and the spline warp consumes the already-magnified depth coordinate.
This is exactly the order cadtrain wants for a 3D port: magnify in MD, then bend
along the survey.

---

## Adapting to cadtrain 3D zScale-then-spline

cadtrain places parts along a survey, bakes with ManifoldCAD, renders in
Threlte. The 2D `yScale + DTX` maps cleanly onto a 1D **along-hole MD reparam**
that you apply to part positions/lengths *before* warping onto the trajectory.

**Recommended pipeline (mirrors §5):**

1. **Collect nodes in MD.** For every "jewellery" part (nipple, valve, short
   sub, mule shoe) emit `{start, end}` = its MD top/bottom. `maxDepth` = deepest
   feature + pad. (Same as `fetchDirData` L1044-1072.)

2. **Build the DTX LUT** with the *unchanged* `autoNodes` algorithm (it is pure
   JS, no `turf`/`everpolate` — drop `+server.js` L119-160 + the `_lerpDTX`
   helper straight in). Tunables to expose as dials (Rule "expose, don't hide"):
   - **`SHORT_THRESHOLD = 50`** (m) — what counts as "small jewellery".
   - **`BUDGET = 50/0.3 ≈ 166.67`** — the constant weighted-length each small
     item gets; *this is the real magnification knob*. A `zMagnify` slider
     should drive this (e.g. `BUDGET = SHORT_THRESHOLD / (k)` with k∈[0.1,1]).
   - Keep the `weight = max(1, BUDGET/len)` form so long parts and gaps stay
     at slope 1 and only compress to compensate.

3. **Define `zScale` (the cadtrain analogue of `yScale`).** In 3D you usually
   want **true scale** along the hole, so default `zScale = 1`. Offer an
   auto-fit `zScale = clamp(TARGET_LEN / maxDepth, lo, hi)` only if you render
   the whole well to a fixed on-screen height; for an explorable 3D scene prefer
   a user multiplier. Note: unlike 2D, **non-uniform Z vs radial scaling
   distorts geometry** — if you stretch Z you must NOT stretch radius, so a
   `zScale ≠ 1` makes parts visually elongated (acceptable for a schematic-style
   view, wrong for a true-shape CAD view). Gate it behind a "schematic mode".

4. **Reparametrise MD before the spline warp.** Define
   `mdView = DTX(mdReal)` (the lerp). Then:
   - **Positions:** a part anchored at `mdReal` is placed at arc-length
     `mdView * zScale` (or just `mdView` if you bake true positions and only
     scale the camera/scene). Warp `mdView` onto the trajectory spline exactly
     as SVTC feeds `yW` into `dirWarp` — i.e. evaluate the survey arc at the
     **transformed** station MDs (port `buildSegments(autoSurvey)` → your spline
     sampler runs on DTX-remapped stations). **Crucial:** remap the survey
     stations through DTX once (build the "view spline"), then place parts by
     their `mdView`; don't apply DTX twice.
   - **Lengths:** a part spanning `[mdReal0, mdReal1]` becomes
     `[DTX(mdReal0), DTX(mdReal1)]`; because DTX slope varies, a short tool's
     baked length is *stretched* and neighbouring filler *compressed*. If you
     bake parts with ManifoldCAD at true length and only want visual
     magnification, instead scale each part's local Z by
     `slope = (DTX(end)-DTX(start))/(end-start)` and re-stack — but that
     distorts geometry (see (3)); for a faithful 3D scene prefer magnifying the
     **spacing/positions** only and leaving each part true-size, accepting that
     dense zones simply spread apart along the hole.

5. **Ruler/labels.** Keep real-MD tick labels; place each tick at `DTX(mdReal)`
   along the (view) spline — same as `Wson2DRenderer` L112-115. Ticks will bunch
   in compressed zones; that non-uniform spacing is the intended signal. Use the
   same nice 1/2/5/10×10ⁿ selector (L742-746). Add the `↕` "along-hole MD" hint.

**Sequencing rule to enforce (the whole point of #5):**
`mdReal → DTX (straight MD space) → warp along survey spline → zScale/scene`.
Build the view-spline from DTX-remapped survey stations once; place every part
by its transformed MD; never warp first then DTX.

**Gotchas carried over:**
- DTX must be **rebuilt** whenever any jewellery MD changes (SVTC debounces via
  `scheduleDirRefresh` 250 ms, L1026-1028). In cadtrain recompute on graph edit.
- The transform is **continuous & monotonic** — safe to sample densely along the
  spline (SVTC samples 30–100 steps per section). For ManifoldCAD, sample the
  view-spline finely enough that magnified bends stay smooth.
- DTX never changes total along-hole length in transformed space (renormalised
  to `maxDepth`); your auto-fit `zScale` can still be derived from raw
  `maxDepth`, exactly as SVTC keeps `yScale` independent of `totalW`.
