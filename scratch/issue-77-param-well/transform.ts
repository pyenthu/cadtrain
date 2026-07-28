/**
 * #77 first artifact — PARAM-SHAPE w2_completion_vert → w_well_native.
 *
 * Turns each `parts_table` node in w2_completion_vert into
 *   (a) a typed `list<record>` PARAM whose `default` = the table's literal rows
 *       lifted to plain record objects, and
 *   (b) a `parts_map` node (SAME node id) that lowers the list param to N part
 *       instances: `Array.from(p.<list>, (s,i) => src({ col: s.col, … }))`.
 * The parts_stack, the list root, appearance/warp meta, layout, viewport — all
 * left UNCHANGED. Then runs the REAL emitter (`emitGraph`) → the full
 * w_well_native.asm.ts (meta WITH params + emitted geom body).
 *
 * Naming (per the task): bw_cement→`cements`/Cement, bw_open_hole→`openholes`/
 * Openhole, bw_casing→`casings`/Casing. The record type name is only a GUI-schema
 * label — the bake reads the list DATA + the parts_map argMap, so it need NOT be
 * pre-registered in the volume `types/` library.
 *
 * The `list<record>` param default reproduces the literal rows EXACTLY, so the
 * default-param bake is byte-for-byte the original geometry — see bake-compare.ts.
 *
 * RUN (bun needs the SvelteKit `$lib` alias, which the bare root tsconfig.json
 * omits): temporarily add to tsconfig.json compilerOptions —
 *     "baseUrl": ".", "paths": { "$lib": ["src/lib"], "$lib/*": ["src/lib/*"],
 *                                 "$shared": ["src/lib/shared"], "$shared/*": ["src/lib/shared/*"] }
 * then from the repo root:  bun scratch/issue-77-param-well/transform.ts
 * (dev server must be up on :3333 — it serves the original source). Writes
 * w_well_native.asm.ts + w_well_native.probe.asm.ts next to this file.
 */
import { emitGraph } from '$lib/graph/composition/composition-emit';
import { writeFileSync } from 'fs';

const BASE = process.env.CADTRAIN_BASE ?? 'http://localhost:3333';
const OUT = new URL('.', import.meta.url).pathname;

// src → { param name, record type name }.
const NAMING: Record<string, { param: string; record: string }> = {
  bw_cement:    { param: 'cements',   record: 'Cement' },
  bw_open_hole: { param: 'openholes', record: 'Openhole' },
  bw_casing:    { param: 'casings',   record: 'Casing' },
};

/** Lift a table row `{col: {kind:'literal', value:v}}` → a plain record `{col: v}`.
 *  A non-literal cell (expr/param) is kept verbatim (this well's rows are all
 *  literal). */
function liftRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) out[k] = (v && typeof v === 'object' && v.kind === 'literal') ? v.value : v;
  return out;
}

const resp = await (await fetch(`${BASE}/api/primitives/source?name=w2_completion_vert`)).json();
const graph: any = structuredClone(resp.graph);

const newParams: Record<string, any> = {};
for (const [id, node] of Object.entries<any>(graph.nodes)) {
  if (node?.type !== 'parts_table') continue;
  const src: string = node.src;
  const naming = NAMING[src];
  if (!naming) throw new Error(`no naming rule for parts_table src="${src}" (node ${id})`);
  const columns: string[] = Array.isArray(node.columns) ? node.columns.slice() : [];
  const rows: any[] = Array.isArray(node.rows) ? node.rows : [];

  // (a) list<record> param — default = the lifted literal rows.
  newParams[naming.param] = { kind: 'list', of: { record: naming.record }, default: rows.map(liftRow) };

  // (b) replace the parts_table with a parts_map of the SAME id (root children +
  //     layout + appearance refs keyed by id keep resolving). argMap reads each
  //     column off the per-row binding `s` via an `expr` ArgValue.
  const argMap: Record<string, any> = {};
  for (const col of columns) argMap[col] = { kind: 'expr', expr: `s.${col}` };
  graph.nodes[id] = { id, type: 'parts_map', src, list: { kind: 'param', param: naming.param }, loopVar: 's', argMap, op: 'list' };
}
graph.params = newParams; // emitGraph mirrors graph.params → meta.params

const res = emitGraph(graph, { id: 'w_well_native' });
if (res.validationErrors.length) { console.error('VALIDATION ERRORS', res.validationErrors); process.exit(1); }
writeFileSync(`${OUT}/w_well_native.asm.ts`, res.source);

// Faithful bake-PROBE — /preview coerces its `params` array to numbers, so it
// can't hand a list<record> object to the object-style assembly. Append a
// zero-arg `w_probe` that calls w_well_native with the DECLARED defaults, so the
// bake flows through the exact `Array.from(p.<list>, s => src({…}))` path.
const defaultObj: Record<string, any> = {};
for (const [k, schema] of Object.entries<any>((res.meta as any).params)) defaultObj[k] = schema.default;
writeFileSync(`${OUT}/w_well_native.probe.asm.ts`,
  `${res.source}\nexport function w_probe() {\n  return w_well_native(${JSON.stringify(defaultObj)});\n}\n`);

console.log('emitted w_well_native.asm.ts (', res.source.length, 'bytes ) — params:', Object.keys(newParams).join(', '));
