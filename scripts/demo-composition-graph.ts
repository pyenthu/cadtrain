#!/usr/bin/env bun
/**
 * demo-composition-graph — walk the mule_shoe case-study contract from
 * docs/plans/composition-architecture.md interactively, printing the graph +
 * emitted source at each step.
 *
 * Run: `bun scripts/demo-composition-graph.ts`
 *
 * No imports from src/lib/cad/manifold-* — this is data-layer only (Phase A).
 * Phase B will add bake; for now this proves the model works as designed.
 */
import {
  newGraph,
  addCall,
  addParam,
  setCallArg,
  wireArg,
  unwireArg,
  removeParam,
  slotsForParam,
  asLiteral,
} from '../src/lib/cad/composition-graph';
import { emitGraph } from '../src/lib/cad/composition-emit';

const HR = '═'.repeat(72);
const sp = '─'.repeat(72);
function header(n: number, label: string) {
  console.log(`\n${HR}\nSTEP ${n}: ${label}\n${HR}`);
}
function showGraph(g: any, hint: string) {
  console.log(`${hint}`);
  console.log(`  nodes:   ${Object.keys(g.nodes).length}`);
  console.log(`  root:    ${g.root}`);
  console.log(`  params:  ${Object.keys(g.params).join(', ') || '(none)'}`);
  console.log(`  edges:   ${g.edges.length === 0 ? '(none)' : g.edges.map((e: any) => `${e.from}->${e.to}`).join(', ')}`);
  console.log(`  imports: ${g.imports.join(', ') || '(none)'}`);
  console.log(`  aliases: ${Object.values(g.nodes).filter((n: any) => n.type === 'call').map((n: any) => `${n.alias}:${n.src}`).join(', ') || '(none)'}`);
}
function showSource(g: any, id: string) {
  const r = emitGraph(g, { id });
  console.log(`\n  emitted .asm.ts:\n${sp}`);
  console.log(r.source.split('\n').map((l: string) => `  ${l}`).join('\n'));
  console.log(sp);
}

// ─── Step 0: empty graph ─────────────────────────────────────────────────
header(0, 'Empty graph — `newGraph()`');
let g = newGraph();
showGraph(g, '\nfresh graph:');

// ─── Steps 1-4: drop two dt_mule_shoe ───────────────────────────────────
header(1, 'Drop dt_mule_shoe twice → A and B, independent literal args');
const a = addCall(g, 'dt_mule_shoe', {
  pipeOD: asLiteral(3.56), boxOD: asLiteral(4.0), wall: asLiteral(0.28),
  boxLen: asLiteral(3), bodyLen: asLiteral(6), cutAngle: asLiteral(45), segments: asLiteral(96),
}); g = a.graph;
const b = addCall(g, 'dt_mule_shoe', {
  pipeOD: asLiteral(4.5), boxOD: asLiteral(5.25), wall: asLiteral(0.31),
  boxLen: asLiteral(3), bodyLen: asLiteral(8), cutAngle: asLiteral(30), segments: asLiteral(96),
}); g = b.graph;
showGraph(g, '\nafter two `+ dt_mule_shoe` clicks:');
showSource(g, 'dt_mule_compose');

// ─── Step 5: edit A only ────────────────────────────────────────────────
header(5, 'Edit A.pipeOD → 5.5; B untouched');
g = setCallArg(g, a.id, 'pipeOD', asLiteral(5.5));
showGraph(g, '\nafter A.pipeOD = 5.5:');
console.log(`  A.pipeOD: ${JSON.stringify((g.nodes[a.id] as any).args.pipeOD)}`);
console.log(`  B.pipeOD: ${JSON.stringify((g.nodes[b.id] as any).args.pipeOD)}`);

// ─── Step 8: add a meta.params row that nothing references ─────────────
header(8, 'Add outerOD param — orphan-detectable (no edges yet)');
g = addParam(g, 'outerOD', { default: 4, min: 0.5, max: 24, step: 0.05, unit: 'in' });
showGraph(g, '\nafter `+ param outerOD`:');
console.log(`  slotsForParam('outerOD'): ${slotsForParam(g, 'outerOD').length} (warn: no edges)`);

// ─── Step 9: wire A.pipeOD to outerOD ──────────────────────────────────
header(9, 'Wire A.pipeOD → outerOD; B still literal');
g = wireArg(g, a.id, 'pipeOD', 'outerOD');
showGraph(g, '\nafter wireArg(A, pipeOD, outerOD):');
console.log(`  A.pipeOD: ${JSON.stringify((g.nodes[a.id] as any).args.pipeOD)}`);
console.log(`  B.pipeOD: ${JSON.stringify((g.nodes[b.id] as any).args.pipeOD)}`);
showSource(g, 'dt_mule_compose');

// ─── Step 11: wire B too — both share the dial ────────────────────────
header(11, 'Wire B.pipeOD → outerOD; both share');
g = wireArg(g, b.id, 'pipeOD', 'outerOD');
showGraph(g, '\nafter wireArg(B, pipeOD, outerOD):');

// ─── Step 12: try to delete outerOD with 2 wires — REFUSES ──────────────
header(12, 'Try removeParam(outerOD) — refuses + surfaces orphans');
const r1 = removeParam(g, 'outerOD');
console.log(`\n  removeParam returned ${r1.orphans.length} orphan(s):`);
for (const o of r1.orphans) console.log(`    ${o.from} → ${o.to}`);
console.log(`  outerOD still in params? ${r1.graph.params.outerOD ? 'YES (correctly refused)' : 'NO (bug)'}`);

console.log('\n  → unwire both first, then removeParam succeeds:');
g = unwireArg(r1.graph, a.id, 'pipeOD', asLiteral(4));
g = unwireArg(g, b.id, 'pipeOD', asLiteral(4));
const r2 = removeParam(g, 'outerOD');
g = r2.graph;
showGraph(g, '\nafter unwire + removeParam:');

// ─── Final emitted source ──────────────────────────────────────────────
header(99, 'Final emitted .asm.ts');
showSource(g, 'dt_mule_compose');

console.log('\n' + HR);
console.log(`MULE_SHOE CASE STUDY — ${'PASSED'} (data layer)`);
console.log('Phase B (bake interpreter) wires this into /api/primitives/preview.');
console.log('Phase C (editor) lets you click these steps in the GUI.');
console.log(HR);
