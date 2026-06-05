/**
 * render-vocab-graph — emit the vocabulary as a Mermaid graph TD diagram.
 *
 * Pure deterministic, no LLM. Walks `vocabulary.json` and emits:
 *   - One node per term, labeled with the rule's template / derived
 *     profile (e.g. "pin\ndp_spec_pin") so the diagram shows what's
 *     under each term at a glance.
 *   - Dashed `extends` edges (inheritance — pin extends shaft).
 *   - Solid `imports` edges (composition — joint imports box/tube/pin).
 *   - Subgraph clusters for primitives (rev/kind=rev) vs assemblies
 *     (asm/kind=asm) so the rendered diagram reads as two columns.
 *
 * Run: `bun scripts/render-vocab-graph.ts`           # prints Mermaid to stdout
 *      `bun scripts/render-vocab-graph.ts --markdown` # wraps in fence for pasting
 *      `bun scripts/render-vocab-graph.ts > docs/parts/vocabulary-graph.mmd`
 */
const wrap = process.argv.includes('--markdown');
const vocab = JSON.parse(await Bun.file('docs/parts/vocabulary.json').text());

const lines: string[] = [];
lines.push('graph TD');
lines.push(`  %% Auto-generated from vocabulary.json v${vocab.version}`);
lines.push('');

// Subgraph clusters by kind.
const primitives = Object.entries(vocab.terms).filter(([, t]: any) => t.kind === 'rev');
const assemblies = Object.entries(vocab.terms).filter(([, t]: any) => t.kind === 'asm');

function nodeLabel(term: string, t: any): string {
  const tmpl = t.rule?.template;
  const derived = t.rule?.derived_from_profile;
  const sub =
    derived ? derived :
    tmpl === 'polygon_inline' ? '' :
    tmpl && tmpl !== 'cylinder' ? tmpl : '';
  return sub ? `${term}<br/><i>${sub}</i>` : term;
}

lines.push('  subgraph PRIMITIVES["Primitives (.rev.ts)"]');
for (const [term, t] of primitives) lines.push(`    ${term}["${nodeLabel(term, t)}"]`);
lines.push('  end');
lines.push('');
lines.push('  subgraph ASSEMBLIES["Assemblies (.asm.ts)"]');
for (const [term, t] of assemblies) lines.push(`    ${term}["${nodeLabel(term, t)}"]`);
lines.push('  end');
lines.push('');

// Extends edges (dashed)
lines.push('  %% extends (inheritance) — dashed');
for (const [term, t] of Object.entries(vocab.terms) as any[]) {
  if (t.extends) lines.push(`  ${t.extends} -.extends.-> ${term}`);
}
lines.push('');

// Imports edges (solid) — only for asm composes
lines.push('  %% imports (composition) — solid');
for (const [term, t] of Object.entries(vocab.terms) as any[]) {
  if (t.rule?.kind === 'compose' && Array.isArray(t.rule.imports)) {
    for (const imp of t.rule.imports) {
      lines.push(`  ${imp.term} --> ${term}`);
    }
  }
}
lines.push('');

// Class styling — primitives = blue, assemblies = green
lines.push('  classDef prim fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e');
lines.push('  classDef asm  fill:#dcfce7,stroke:#15803d,color:#14532d');
for (const [term, t] of Object.entries(vocab.terms) as any[]) {
  lines.push(`  class ${term} ${t.kind === 'rev' ? 'prim' : 'asm'}`);
}

const out = lines.join('\n');
if (wrap) {
  console.log('```mermaid');
  console.log(out);
  console.log('```');
} else {
  console.log(out);
}
