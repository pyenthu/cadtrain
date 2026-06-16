/**
 * graph-editor-args.ts — pure ArgValue / expression formatting + profile-kind
 * lookups for the node-graph CAD editor (`GraphEditorPane.svelte`).
 *
 * EXTRACTED 2026-06-16 (modularize plan P2 / G2, `docs/plans/modularize.md`).
 * RULE (same as graph-editor-geom.ts): every function here is PURE — no
 * component `$state`, no DOM. Functions that previously closed over `graph`
 * now take it as an explicit first parameter. Outputs are byte-identical to the
 * in-component originals for the same inputs.
 */
import { PROFILE_REGISTRY, type ProfileDef } from '$lib/shared/profile-presets';
import type { Graph, NodeId } from '$lib/cad/composition-graph';

/** ArgValue → display string. literal→value, param→`p.<name>`, expr→raw. */
export function argStr(a: any): string {
  if (!a) return '0';
  if (a.kind === 'literal') return String(a.value);
  if (a.kind === 'param') return `p.${a.param}`;
  return String(a.expr ?? '');
}

/** Editable string → ArgValue: a bare number → literal, else expr. */
export function argFrom(s: string): any {
  const t = (s ?? '').trim();
  if (/^-?\d*\.?\d+$/.test(t)) return { kind: 'literal', value: Number(t) };
  return { kind: 'expr', expr: t };
}

/** ArgValue → the string shown in an expr-edit draft input. */
export function argToDraftStr(v: any): string {
  if (!v) return '';
  if (v.kind === 'expr')    return String(v.expr ?? '');
  if (v.kind === 'param')   return `p.${v.param}`;
  if (v.kind === 'literal') return String(v.value ?? 0);
  return '';
}

/** Evaluate an ArgValue to a number against a param scope `p`. */
export function evalArg(a: any, p: Record<string, number>): number {
  if (!a) return 0;
  if (a.kind === 'literal') return Number(a.value) || 0;
  if (a.kind === 'param') return Number(p[a.param] ?? 0);
  try { return Number(new Function('p', `with(p){ return (${String(a.expr)}); }`)(p)) || 0; } catch { return 0; }
}

/** Param scope {name: default} for evaluating ArgValue fields to numbers. */
export function sketchParamScope(graph: Graph): Record<string, number> {
  const s: Record<string, number> = {};
  for (const [k, v] of Object.entries(graph.params)) s[k] = Number((v as any)?.default ?? 0);
  return s;
}

/** Profile-producing nodes (polygon / sketch) in the graph. */
export function profileProducers(graph: Graph): any[] {
  return Object.values(graph.nodes).filter((n: any) => n.type === 'polygon' || n.type === 'sketch') as any[];
}

/** Short human label for a profile-producer node. */
export function producerLabel(graph: Graph, id: NodeId): string {
  const n = graph.nodes[id] as any;
  if (!n) return '(missing)';
  if (n.type === 'sketch') return `sketch`;
  if (n.type === 'polygon') return `polygon · ${(n.points ?? []).length} pts`;
  return n.type;
}

/** Parse a profile-descriptor expr (`{kind, params}`) — null when it isn't a
 *  parseable JSON object (e.g. a custom math expression). */
export function parseProfileExpr(expr: string): { kind?: string; params?: Record<string, number> } | null {
  if (!expr || !expr.trim().startsWith('{')) return null;
  try { return JSON.parse(expr); } catch { return null; }
}

/** Curated profile kinds available for a given set, sorted by label. */
export function kindsForSet(set: 'revolve' | 'cartesian'): ProfileDef[] {
  return Object.values(PROFILE_REGISTRY)
    .filter((d) => d.set === set)
    .sort((a, b) => a.label.localeCompare(b.label));
}
