#!/usr/bin/env bun
/**
 * build_g_parts — author the g_* graph-editor exemplar primitives.
 *
 * Usage: `bun scripts/build_g_parts.ts <id>` where <id> is one of:
 *   g_spiral     — flat coil disc (two poly_repeat loops, r_weld_extrude)
 *   g_star       — extruded star polygon (single loop, r_weld_extrude)
 *   g_collar     — revolved collar with rounded top (literal verts, r_revolve)
 *   g_dt_joint   — box + pipe + pin placed via place([…]) along z
 *
 * Constructs the graph in code, calls emitGraph() to get the canonical
 * source text (same emitter the editor uses), POSTs to
 * /api/primitives/save against $CADTRAIN_VOLUME_REMOTE_URL (default
 * https://cadtrain.up.railway.app — the SINGLE STORE per Rule 13 / the
 * api CLAUDE.md proxy contract), then bake-verifies via /preview.
 */
import type { Graph } from '../src/lib/cad/composition-graph';
import { emitGraph } from '../src/lib/cad/composition-emit';

const BASE = process.env.CADTRAIN_VOLUME_REMOTE_URL || 'https://cadtrain.up.railway.app';
const TOKEN = process.env.CADTRAIN_VOLUME_TOKEN || '';

const which = process.argv[2];
if (!which) {
  console.error('Usage: bun scripts/build_g_parts.ts <g_spiral|g_star|g_collar|g_dt_joint>');
  process.exit(1);
}

// ─── builders ─────────────────────────────────────────────────────────────

function buildGSpiral(): { graph: Graph; id: string; description: string; params: Record<string, number> } {
  // Node ids — n_<lowercase-alnum> only. The composition-emit consumer
  // detector uses `/__POLY__(n_[a-z0-9]+)/` so underscores past index 1
  // truncate the match → polygon never gets marked consumed → root list
  // emits the polygon + the call instead of just the call's solid.
  const ID_ROOT = 'n_gspr1', ID_POLY = 'n_gspr2',
        ID_LOOP_OUT = 'n_gspr3', ID_LOOP_IN = 'n_gspr4',
        ID_CALL = 'n_gspr5';
  const params = {
    NPts:   { default: 60,   step: 1,    min: 8,   max: 360 },
    r0:     { default: 0.4,  step: 0.05, min: 0.05, max: 4   },
    growth: { default: 1.0,  step: 0.05, min: 0,    max: 5   },
    turns:  { default: 2,    step: 0.25, min: 0.5,  max: 10  },
    width:  { default: 0.06, step: 0.01, min: 0.01, max: 0.5 },
    length: { default: 0.4,  step: 0.05, min: 0.1,  max: 5   },
  };
  const graph: Graph = {
    root: ID_ROOT,
    params: params as any,
    imports: ['r_weld_extrude'],
    edges: [],
    layout: {
      [ID_ROOT]:     { x: 720, y: 380 },
      [ID_POLY]:     { x:  80, y: 240, w: 220, h: 180 },
      [ID_LOOP_OUT]: { x: 380, y:  60, w: 240, h: 260 },
      [ID_LOOP_IN]:  { x: 380, y: 380, w: 240, h: 280 },
      [ID_CALL]:     { x: 800, y:  80 },
    },
    viewport: { pan: { x: 0, y: 0 }, zoom: 0.9 },
    nodes: {
      [ID_ROOT]: { id: ID_ROOT, type: 'list', children: [ID_POLY, ID_CALL] },
      [ID_POLY]: {
        id: ID_POLY,
        type: 'polygon',
        points: [
          { kind: 'repeat-ref', sourceId: ID_LOOP_OUT },
          { kind: 'repeat-ref', sourceId: ID_LOOP_IN  },
        ],
      } as any,
      [ID_LOOP_OUT]: {
        id: ID_LOOP_OUT,
        type: 'poly_repeat',
        count: { kind: 'param', param: 'NPts' },
        loopVar: 'i',
        r: { kind: 'expr', expr: 'R * cos(theta)' },
        z: { kind: 'expr', expr: 'R * sin(theta)' },
        bindings: [
          { name: 'R0',    value: { kind: 'param', param: 'r0'     } },
          { name: 'dr',    value: { kind: 'param', param: 'growth' } },
          { name: 'turns', value: { kind: 'param', param: 'turns'  } },
          { name: 'theta', value: { kind: 'expr',  expr:  'i * turns * tau / NPts' } },
          { name: 'R',     value: { kind: 'expr',  expr:  'R0 + dr * i / NPts' } },
        ],
      },
      [ID_LOOP_IN]: {
        id: ID_LOOP_IN,
        type: 'poly_repeat',
        count: { kind: 'param', param: 'NPts' },
        loopVar: 'j',
        r: { kind: 'expr', expr: 'R * cos(theta)' },
        z: { kind: 'expr', expr: 'R * sin(theta)' },
        bindings: [
          { name: 'R0',    value: { kind: 'param', param: 'r0'     } },
          { name: 'dr',    value: { kind: 'param', param: 'growth' } },
          { name: 'turns', value: { kind: 'param', param: 'turns'  } },
          { name: 'width', value: { kind: 'param', param: 'width'  } },
          { name: 'idx',   value: { kind: 'expr',  expr:  'NPts - 1 - j' } },
          { name: 'theta', value: { kind: 'expr',  expr:  'idx * turns * tau / NPts' } },
          { name: 'R',     value: { kind: 'expr',  expr:  'R0 + dr * idx / NPts + width' } },
        ],
      },
      [ID_CALL]: {
        id: ID_CALL,
        type: 'call',
        src: 'r_weld_extrude',
        alias: 'A',
        args: {
          profile:  { kind: 'expr',    expr:  `__POLY__${ID_POLY}` },
          length:   { kind: 'param',   param: 'length' },
          divs:     { kind: 'literal', value: 12 },
          twist:    { kind: 'literal', value: 0  },
          taper:    { kind: 'literal', value: 0  },
          segments: { kind: 'literal', value: 32 },
        },
      } as any,
    },
  };
  return {
    graph,
    id: 'g_spiral',
    description: 'Flat coil disc — Archimedean spiral cross-section (two-loop graph), extruded down z. Showcases polygon repeat-refs + NPts auto-binding.',
    params: { NPts: 60, r0: 0.4, growth: 1.0, turns: 2, width: 0.06, length: 0.4 },
  };
}

function buildGStar(): { graph: Graph; id: string; description: string; params: Record<string, number> } {
  const ID_ROOT = 'n_gstar1', ID_POLY = 'n_gstar2',
        ID_LOOP = 'n_gstar3', ID_CALL = 'n_gstar4';
  const params = {
    points:   { default: 6,   step: 1,    min: 3,   max: 24  },
    r_outer:  { default: 1.0, step: 0.05, min: 0.1, max: 5   },
    r_inner:  { default: 0.4, step: 0.05, min: 0.05, max: 5  },
    length:   { default: 0.6, step: 0.05, min: 0.1, max: 10  },
  };
  // 2 * points vertices alternating outer/inner radius around a circle.
  const graph: Graph = {
    root: ID_ROOT,
    params: params as any,
    imports: ['r_weld_extrude'],
    edges: [],
    layout: {
      [ID_ROOT]: { x: 720, y: 360 },
      [ID_POLY]: { x:  80, y: 280, w: 220, h: 140 },
      [ID_LOOP]: { x: 380, y: 220, w: 240, h: 240 },
      [ID_CALL]: { x: 800, y: 100 },
    },
    viewport: { pan: { x: 0, y: 0 }, zoom: 0.9 },
    nodes: {
      [ID_ROOT]: { id: ID_ROOT, type: 'list', children: [ID_POLY, ID_CALL] },
      [ID_POLY]: {
        id: ID_POLY,
        type: 'polygon',
        points: [{ kind: 'repeat-ref', sourceId: ID_LOOP }],
      } as any,
      [ID_LOOP]: {
        id: ID_LOOP,
        type: 'poly_repeat',
        // Twice the point count for the star (outer + inner alternating).
        count: { kind: 'expr', expr: '2 * p.points' },
        loopVar: 'i',
        r: { kind: 'expr', expr: 'R * cos(theta)' },
        z: { kind: 'expr', expr: 'R * sin(theta)' },
        bindings: [
          { name: 'rOut',  value: { kind: 'param', param: 'r_outer' } },
          { name: 'rIn',   value: { kind: 'param', param: 'r_inner' } },
          { name: 'theta', value: { kind: 'expr',  expr:  'i * tau / NPts' } },
          { name: 'R',     value: { kind: 'expr',  expr:  'i % 2 === 0 ? rOut : rIn' } },
        ],
      },
      [ID_CALL]: {
        id: ID_CALL,
        type: 'call',
        src: 'r_weld_extrude',
        alias: 'A',
        args: {
          profile:  { kind: 'expr',    expr:  `__POLY__${ID_POLY}` },
          length:   { kind: 'param',   param: 'length' },
          divs:     { kind: 'literal', value: 12 },
          twist:    { kind: 'literal', value: 0  },
          taper:    { kind: 'literal', value: 0  },
          segments: { kind: 'literal', value: 32 },
        },
      } as any,
    },
  };
  return {
    graph,
    id: 'g_star',
    description: 'Extruded star — single poly_repeat alternates outer/inner radius via i % 2. Showcases conditional bindings + parametric NPts.',
    params: { points: 6, r_outer: 1.0, r_inner: 0.4, length: 0.6 },
  };
}

function buildGCollar(): { graph: Graph; id: string; description: string; params: Record<string, number> } {
  const ID_ROOT = 'n_gcol1', ID_POLY = 'n_gcol2', ID_CALL = 'n_gcol3';
  const params = {
    od:        { default: 2.0,  step: 0.05, min: 0.2, max: 20 },
    bore:      { default: 0.6,  step: 0.05, min: 0,   max: 20 },
    len:       { default: 1.5,  step: 0.05, min: 0.1, max: 20 },
    fillet:    { default: 0.25, step: 0.05, min: 0.0, max: 5  },
    segments:  { default: 64,   step: 1,    min: 8,   max: 256 },
  };
  // Half-section (r,z) — bore on the left, body on the right, rounded TOP
  // shoulder via a simple 3-point arc approximation. Z-down: z=0 is the
  // top face, z=len is the bottom face.
  //
  //   (ri, 0) -------- (ri, len)       <- inner bore
  //                         |
  //                    (ro, len)       <- outer bottom
  //                         |
  //                    (ro, fillet)    <- straight side
  //   round corner: 3 points
  //                    (ro - f/3, f/3)
  //                    (ro - f,   0)   <- approx 90° corner
  //   (ri, 0) closes back
  //
  // 6 vertices total, rounded top.
  const graph: Graph = {
    root: ID_ROOT,
    params: params as any,
    imports: ['r_revolve'],
    edges: [],
    layout: {
      [ID_ROOT]: { x: 720, y: 360 },
      [ID_POLY]: { x:  80, y: 200, w: 220, h: 260 },
      [ID_CALL]: { x: 800, y: 100 },
    },
    viewport: { pan: { x: 0, y: 0 }, zoom: 0.9 },
    nodes: {
      [ID_ROOT]: { id: ID_ROOT, type: 'list', children: [ID_POLY, ID_CALL] },
      [ID_POLY]: {
        id: ID_POLY,
        type: 'polygon',
        points: [
          { kind: 'point',
            r: { kind: 'expr', expr: 'p.bore / 2' },
            z: { kind: 'literal', value: 0 } },
          { kind: 'point',
            r: { kind: 'expr', expr: 'p.bore / 2' },
            z: { kind: 'param', param: 'len' } },
          { kind: 'point',
            r: { kind: 'expr', expr: 'p.od / 2' },
            z: { kind: 'param', param: 'len' } },
          { kind: 'point',
            r: { kind: 'expr', expr: 'p.od / 2' },
            z: { kind: 'expr', expr: 'p.fillet' } },
          // Rounded top shoulder — quadrant approximation, 2 mid-points.
          { kind: 'point',
            r: { kind: 'expr', expr: 'p.od/2 - p.fillet * 0.293' }, // 1 - cos(45°)
            z: { kind: 'expr', expr: 'p.fillet * 0.293' } },
          { kind: 'point',
            r: { kind: 'expr', expr: 'p.od/2 - p.fillet' },
            z: { kind: 'literal', value: 0 } },
        ],
      } as any,
      [ID_CALL]: {
        id: ID_CALL,
        type: 'call',
        src: 'r_revolve',
        alias: 'A',
        args: {
          profile:  { kind: 'expr',  expr: `__POLY__${ID_POLY}` },
          segments: { kind: 'param', param: 'segments' },
        },
      } as any,
    },
  };
  return {
    graph,
    id: 'g_collar',
    description: 'Revolved collar with rounded top shoulder. Literal-vertex half-section showcases the graph editor with a small fixed polygon (no loops).',
    params: { od: 2.0, bore: 0.6, len: 1.5, fillet: 0.25, segments: 64 },
  };
}

function buildGDtJoint(): { graph: Graph; id: string; description: string; params: Record<string, number> } {
  // Three named sub-parts inside one assembly graph:
  //   - box   = revolved at z=0..box_len     (pin connection above pipe)
  //   - pipe  = revolved at z=0..pipe_len    (placed at z = box_len)
  //   - pin   = revolved at z=0..pin_len     (placed at z = box_len+pipe_len)
  // Combined via place([box, mv(pipe,[0,0,box_len]), mv(pin,[0,0,box_len+pipe_len])]).
  // place() composes (no boolean) so each part keeps its color via Manifold's
  // mesh relation.
  //
  // The three polygons are simple half-sections (cylindrical body, no taper).
  // Showcase: three (polygon → r_revolve) pairs co-existing in one graph,
  // combined via mv + place into a single returned manifold.
  const ID_ROOT = 'n_gdtj0';
  const ID_BOX_P  = 'n_gdtj1', ID_BOX_C  = 'n_gdtj2';
  const ID_PIPE_P = 'n_gdtj3', ID_PIPE_C = 'n_gdtj4';
  const ID_PIN_P  = 'n_gdtj5', ID_PIN_C  = 'n_gdtj6';
  const ID_PIPE_MV = 'n_gdtj7', ID_PIN_MV = 'n_gdtj8';
  const ID_PLACE  = 'n_gdtj9';

  const params = {
    od:       { default: 2.5,  step: 0.05, min: 0.5, max: 20, unit: 'in' },
    bore:     { default: 1.0,  step: 0.05, min: 0,   max: 20, unit: 'in' },
    box_od:   { default: 3.0,  step: 0.05, min: 0.5, max: 20, unit: 'in' },
    box_len:  { default: 1.0,  step: 0.05, min: 0.1, max: 10, unit: 'in' },
    pipe_len: { default: 4.0,  step: 0.1,  min: 0.5, max: 60, unit: 'in' },
    pin_od:   { default: 2.6,  step: 0.05, min: 0.5, max: 20, unit: 'in' },
    pin_len:  { default: 0.8,  step: 0.05, min: 0.1, max: 10, unit: 'in' },
    segments: { default: 64,   step: 1,    min: 8,   max: 256 },
  };

  // Helper to build a half-section polygon node for a cylindrical part.
  const cylPoly = (id: string, odExpr: string, lenExpr: string): any => ({
    id, type: 'polygon',
    points: [
      { kind: 'point', r: { kind: 'expr', expr: 'p.bore / 2' }, z: { kind: 'literal', value: 0 } },
      { kind: 'point', r: { kind: 'expr', expr: 'p.bore / 2' }, z: { kind: 'expr', expr: lenExpr } },
      { kind: 'point', r: { kind: 'expr', expr: odExpr },       z: { kind: 'expr', expr: lenExpr } },
      { kind: 'point', r: { kind: 'expr', expr: odExpr },       z: { kind: 'literal', value: 0 } },
    ],
  });

  const graph: Graph = {
    root: ID_ROOT,
    params: params as any,
    imports: ['r_revolve'],
    edges: [],
    layout: {
      [ID_ROOT]:    { x: 1100, y: 380 },
      [ID_BOX_P]:   { x:   60, y:   40, w: 220, h: 200 },
      [ID_BOX_C]:   { x:  340, y:   40 },
      [ID_PIPE_P]:  { x:   60, y:  280, w: 220, h: 200 },
      [ID_PIPE_C]:  { x:  340, y:  280 },
      [ID_PIPE_MV]: { x:  580, y:  280 },
      [ID_PIN_P]:   { x:   60, y:  520, w: 220, h: 200 },
      [ID_PIN_C]:   { x:  340, y:  520 },
      [ID_PIN_MV]:  { x:  580, y:  520 },
      [ID_PLACE]:   { x:  820, y:  280 },
    },
    viewport: { pan: { x: 0, y: 0 }, zoom: 0.8 },
    nodes: {
      // Polygons must be reachable from the root for topoOrder() to assign
      // them varNames; their __POLY__<id> sentinels in call args get
      // substituted post-emit. The consumer set marks them consumed so
      // they don't show in the returned output — only the placed solid does.
      [ID_ROOT]:   { id: ID_ROOT, type: 'list', children: [ID_BOX_P, ID_PIPE_P, ID_PIN_P, ID_PLACE] },
      [ID_BOX_P]:  cylPoly(ID_BOX_P,  'p.box_od / 2', 'p.box_len'),
      [ID_PIPE_P]: cylPoly(ID_PIPE_P, 'p.od / 2',     'p.pipe_len'),
      [ID_PIN_P]:  cylPoly(ID_PIN_P,  'p.pin_od / 2', 'p.pin_len'),
      [ID_BOX_C]: {
        id: ID_BOX_C, type: 'call', src: 'r_revolve', alias: 'BOX',
        args: {
          profile:  { kind: 'expr',  expr: `__POLY__${ID_BOX_P}` },
          segments: { kind: 'param', param: 'segments' },
        },
      } as any,
      [ID_PIPE_C]: {
        id: ID_PIPE_C, type: 'call', src: 'r_revolve', alias: 'PIPE',
        args: {
          profile:  { kind: 'expr',  expr: `__POLY__${ID_PIPE_P}` },
          segments: { kind: 'param', param: 'segments' },
        },
      } as any,
      [ID_PIN_C]: {
        id: ID_PIN_C, type: 'call', src: 'r_revolve', alias: 'PIN',
        args: {
          profile:  { kind: 'expr',  expr: `__POLY__${ID_PIN_P}` },
          segments: { kind: 'param', param: 'segments' },
        },
      } as any,
      [ID_PIPE_MV]: {
        id: ID_PIPE_MV, type: 'mv', child: ID_PIPE_C,
        offset: [
          { kind: 'literal', value: 0 },
          { kind: 'literal', value: 0 },
          { kind: 'param', param: 'box_len' },
        ],
      },
      [ID_PIN_MV]: {
        id: ID_PIN_MV, type: 'mv', child: ID_PIN_C,
        offset: [
          { kind: 'literal', value: 0 },
          { kind: 'literal', value: 0 },
          { kind: 'expr', expr: 'p.box_len + p.pipe_len' },
        ],
      },
      [ID_PLACE]: {
        id: ID_PLACE, type: 'group',
        children: [ID_BOX_C, ID_PIPE_MV, ID_PIN_MV],
      },
    },
  };
  // NOTE: emit's 'group' type emits as `[a, b, c]` (a JS array). That's
  // what r_revolve returns are; we want place([…]) at the root. The
  // root list emits as a singleton when it has one visible child, so
  // we wrap the placed array via a custom shape:
  //
  // Simpler approach: use a method node? No — method is CSG ops only.
  // Instead, swap the root with a list containing 3 children — emit
  // emits `[A, B, C]` for the multi-output composition. But that's still
  // an array, not a place() call.
  //
  // What we ACTUALLY want is one Manifold combining the 3 placed parts.
  // The emit's `repeat` node with op:'place' wraps with place() — but
  // that needs ONE child instanced N times. For heterogeneous parts we
  // need a `place` over an array literal directly.
  //
  // CLEANEST: emit the function and POST-PROCESS the body to wrap the
  // 3-arg `[BOX_var, PIPE_MV_var, PIN_MV_var]` literal with place(...).
  // We do that in the runner below by detecting the return [A, B, C] and
  // rewriting to return place([A, B, C]).
  return {
    graph,
    id: 'g_dt_joint',
    description: 'Drill-pipe joint composition — box + pipe + pin placed via place([…]) along z. Three (polygon → r_revolve) sub-graphs in one assembly; mv() chains move each part to its slot.',
    params: { od: 2.5, bore: 1.0, box_od: 3.0, box_len: 1.0, pipe_len: 4.0, pin_od: 2.6, pin_len: 0.8, segments: 64 },
  };
}

const BUILDERS: Record<string, () => ReturnType<typeof buildGSpiral>> = {
  g_spiral:   buildGSpiral,
  g_star:     buildGStar,
  g_collar:   buildGCollar,
  g_dt_joint: buildGDtJoint,
};

const b = BUILDERS[which];
if (!b) {
  console.error(`unknown id "${which}" — pick one of: ${Object.keys(BUILDERS).join(', ')}`);
  process.exit(1);
}
const built = b();

const result = emitGraph(built.graph, {
  id: built.id,
  description: built.description,
});

let source = result.source;

// g_dt_joint post-process: wrap the `group` array literal with place(). The
// emit produces `const _group_1 = [BOX, _mv_obj_1, _mv_obj_2];` (a JS array).
// We want one combined Manifold via Manifold.compose — sandbox helper
// place([…]) does exactly that. Substitute the array literal.
if (built.id === 'g_dt_joint') {
  source = source.replace(
    /(const\s+_group_\d+\s*=\s*)\[([^\]]+)\];/,
    '$1place([$2]);',
  );
}

console.log('=== validation errors ===');
console.log(result.validationErrors.length ? result.validationErrors : '(none)');
console.log('=== source preview ===');
console.log(source.slice(0, 600));
console.log('...');
console.log(source.slice(-400));
console.log(`\n=== size: ${source.length} bytes ===`);

// SAVE
const saveBody = JSON.stringify({ id: built.id, source, dir: 'basic', kind: 'asm' });
const saveUrl = `${BASE}/api/primitives/save`;
const saveHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
if (TOKEN) saveHeaders['X-Volume-Token'] = TOKEN;
console.log(`\nPOST ${saveUrl}`);
const saveRes = await fetch(saveUrl, { method: 'POST', headers: saveHeaders, body: saveBody });
console.log(`HTTP ${saveRes.status}`);
const saveTxt = await saveRes.text();
console.log(saveTxt);

if (!saveRes.ok) {
  console.error(`\n!!! save failed — bailing before /preview to keep the failure mode obvious`);
  process.exit(1);
}

// BAKE-VERIFY — /preview expects `params` as a POSITIONAL array (numbers in
// meta.params declaration order). The adaptive boundary in primitive-loader
// bundles them back into the object-style `p` arg when isObjectStyle is true.
const prevUrl = `${BASE}/api/primitives/preview`;
const paramKeys = Object.keys(built.graph.params);
const paramsArray = paramKeys.map((k) => (built.params as any)[k]);
console.log(`\nparams (array, ${paramKeys.join('/')}):`, paramsArray);
const prevBody = JSON.stringify({ source, name: built.id, params: paramsArray });
const prev = await fetch(prevUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: prevBody,
});
console.log(`\n=== /preview → HTTP ${prev.status} ===`);
const prevJson: any = await prev.json().catch(() => null);
if (prevJson?.full) {
  const pos = prevJson.full.positions ?? prevJson.full.position;
  const idx = prevJson.full.index;
  const verts = pos?.length ? pos.length / 3 : 0;
  const tris  = idx?.length ? idx.length / 3 : (verts ? verts / 3 : 0);
  console.log(`verts=${verts} tris=${tris}`);
  if (pos && pos.length >= 6) {
    const ps = pos;
    let zmin = Infinity, zmax = -Infinity;
    let xmin = Infinity, xmax = -Infinity;
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 0; k < ps.length; k += 3) {
      xmin = Math.min(xmin, ps[k]);   xmax = Math.max(xmax, ps[k]);
      ymin = Math.min(ymin, ps[k+1]); ymax = Math.max(ymax, ps[k+1]);
      zmin = Math.min(zmin, ps[k+2]); zmax = Math.max(zmax, ps[k+2]);
    }
    console.log(`x-extent: ${xmin.toFixed(3)} .. ${xmax.toFixed(3)}`);
    console.log(`y-extent: ${ymin.toFixed(3)} .. ${ymax.toFixed(3)}`);
    console.log(`z-extent: ${zmin.toFixed(3)} .. ${zmax.toFixed(3)}`);
  }
} else {
  console.log(JSON.stringify(prevJson, null, 2).slice(0, 1500));
}
