/**
 * rule-translator — compile a vocabulary entry (or any rule matching the
 * schema) into a runnable `.rev.ts` / `.asm.ts` source string.
 *
 * Deterministic. No LLM. Pure function `Rule → Source`. Used by:
 *   - Phase 1/2: regenerate dt_* parts from `docs/parts/vocabulary.json`
 *   - Phase 4: WebGPU LLM emits a rule matching the same schema, this
 *     translator compiles it (constrained generation)
 *   - Phase 5/6: chat + chatbot use the same path
 *
 * Two rule kinds today:
 *   - `primitive` — scaffolds a `.rev.ts` via the existing
 *     `buildRevolveSource` pipeline, then overrides params + (optionally)
 *     re-points the profile to a function-profile id with a param map.
 *   - `compose` — scaffolds an `.asm.ts` via `buildAssemblySource`, then
 *     applies imports + composition tree + assembly params using the
 *     K.62 data-layer APIs (`applyToSource`, `addAssemblyParam`).
 *
 * Every generated source gets a `meta.generated_from` trace tag so the
 * supervision flow can later regenerate-and-diff if the vocabulary
 * version moves.
 */

import {
  applyToSource, addAssemblyParam, newNodeId,
  type TreeNode, type ImportDef,
} from '../cad/composition-tree';
import {
  buildAssemblySource, buildRevolveSource, templatesFor,
} from '../cad/profile-templates';
// K.63 graph-based compose-rule emitter (Phase 14). The legacy text-body
// translator (`translateAsm`) is kept for back-compat; new compositions
// emit `meta.graph` via `translateAsmGraph`.
import {
  newGraph, addCall, addMethod, addContainer, addMv, addRepeat,
  addParam as gAddParam,
  setMethodInput, setTransformChild, setTransformAxisValue,
  asLiteral, asExpr, asParam,
  type Graph, type NodeId, type ArgValue, type CsgOp,
} from '../cad/composition-graph';
import { emitGraph } from '../cad/composition-emit';

// ─── Schema types ──────────────────────────────────────────────────────

export interface VocabParam {
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
}

export interface VocabPrimitiveRule {
  kind: 'primitive';
  template: string;                                  // profile-template id (cylinder, collar_flat, dp_spec_pin, …)
  engine?: string;                                   // r_revolve etc. — informational only here
  profile_params_map?: Record<string, string>;       // profileParamKey → expression (e.g. "p.od")
  /** template === 'polygon_inline' path: preamble const declarations
   *  (computed-once intermediate values like ri, pr, jr, …) followed by
   *  the polygon vertex expressions (each evaluates to `[r, z]`). Emitted
   *  inline so the ProfileFnEditor renders + lets the user dial each
   *  vertex. Same shape as the curated templates' bodies but vocab-supplied. */
  preamble?: string[];
  polygon?: string[];
  /** Canonical profile id this polygon was DERIVED from (e.g. dp_spec_pin
   *  for the pin term). Stamped on `meta.profile_kind` so the editor's
   *  profile-swap picker can open on polygon_inline parts even though
   *  the body doesn't contain a resolveProfile() call. */
  derived_from_profile?: string;
}

export interface VocabComposeRule {
  kind: 'compose';
  imports: Array<{ alias: string; term: string }>;
  composition: any;                                  // shape: see treeFromRuleNode below
}

export interface VocabEntry {
  kind: 'rev' | 'asm';
  definition?: string;
  synonyms?: string[];
  extends?: string;
  params: Record<string, VocabParam>;
  param_lifting?: 'hidden' | 'flat';
  rule: VocabPrimitiveRule | VocabComposeRule;
  exemplar: string;
  thread_spec?: any;
  expects_bake?: Record<string, number | null | string>;
}

export interface Vocabulary {
  version: string;
  terms: Record<string, VocabEntry>;
}

// ─── Public API ────────────────────────────────────────────────────────

/** Translate a single vocabulary term into runnable source.
 *  Throws when the term is unknown or the rule references a missing dep.
 *
 *  `opts.format` (default `'graph'` for `kind:'asm'`) picks the emitter for
 *  compose rules:
 *    - `'graph'` (new, Phase 14) — emits `meta.graph` JSON literal that
 *      `/graph-editor` can hydrate with hydrateGraph(). Body is the
 *      machine-generated projection of the graph.
 *    - `'text'` (legacy) — emits the old TreeNode-based text body via
 *      applyToSource. Kept so existing dt_* files don't churn unless
 *      explicitly regenerated.
 *  `kind:'rev'` (primitive) is unaffected — leaves don't have compositions. */
export function translate(
  term: string,
  vocab: Vocabulary,
  opts?: { partId?: string; format?: 'graph' | 'text' },
): string {
  const entry = vocab.terms[term];
  if (!entry) throw new Error(`translate: unknown vocabulary term "${term}"`);
  const partId = opts?.partId ?? entry.exemplar;
  const traceTag = {
    term,
    vocab_version: vocab.version,
    rule_hash: hashRule(entry.rule),
  };
  if (entry.kind === 'rev') return translateRev(entry, partId, traceTag);
  if (entry.kind === 'asm') {
    const fmt = opts?.format ?? 'graph';
    return fmt === 'graph'
      ? translateAsmGraph(entry, vocab, partId, traceTag)
      : translateAsm(entry, vocab, partId, traceTag);
  }
  throw new Error(`translate: unsupported kind "${(entry as any).kind}"`);
}

// ─── Primitive (.rev.ts) ───────────────────────────────────────────────

function translateRev(entry: VocabEntry, partId: string, traceTag: any): string {
  const rule = entry.rule as VocabPrimitiveRule;
  if (rule.kind !== 'primitive') throw new Error('translateRev: rule.kind must be "primitive"');

  const curated = templatesFor('revolve').find((t) => t.id === rule.template);
  let src: string;
  if (curated) {
    src = buildRevolveSource(partId, curated);
    src = overridePartParams(src, partId, entry.params);
  } else if (rule.template === 'polygon_inline' && rule.polygon) {
    // INLINE polygon path — vocab supplies the preamble (intermediate consts
    // like ri, pr, jr, …) + the polygon vertex expressions. The translator
    // scaffolds via the cylinder template then REWRITES the body so the
    // editor sees a normal polygon half-section (PATH section editable).
    const cylinder = templatesFor('revolve').find((t) => t.id === 'cylinder')!;
    src = buildRevolveSource(partId, cylinder);
    src = overridePartParams(src, partId, entry.params);
    src = rewriteRevBodyToInlinePolygon(src, partId, rule, entry.params);
  } else {
    // Function-profile fallback path (resolveProfile call) — still works,
    // but the editor can't visualize the points. Used when the vocab rule
    // doesn't supply an inline polygon.
    const cylinder = templatesFor('revolve').find((t) => t.id === 'cylinder')!;
    src = buildRevolveSource(partId, cylinder);
    src = overridePartParams(src, partId, entry.params);
    src = rewriteRevBodyToFunctionProfile(src, partId, rule, entry.params);
  }
  src = injectTraceTag(src, traceTag);
  // For polygon_inline parts, stamp `meta.profile_kind` so the editor's
  // profile-swap picker (which reads partProfileKind via a resolveProfile
  // body sniff) ALSO recognizes inline-polygon parts as having a
  // canonical profile origin. Without this, the swap ▾ button stays
  // hidden because the body has no resolveProfile(...) call.
  if (rule.template === 'polygon_inline' && rule.derived_from_profile) {
    src = insertMetaField(src, `profile_kind: '${rule.derived_from_profile}'`);
  }
  return src;
}

/** Rewrite the .rev.ts body to use an INLINE polygon (preamble + vertex
 *  expressions from the vocab rule). The ProfileFnEditor can parse this
 *  shape — it's exactly what the curated templates emit. */
function rewriteRevBodyToInlinePolygon(
  src: string,
  partId: string,
  rule: VocabPrimitiveRule,
  params: Record<string, VocabParam>,
): string {
  const paramKeys = Object.keys(params);
  const headRe = new RegExp(`(export\\s+function\\s+${partId}\\s*\\([^)]*\\)\\s*\\{)([\\s\\S]*?)(\\n\\}\\s*$)`);
  const m = src.match(headRe);
  if (!m) return src;
  const head = m[1]!, tail = m[3]!;
  const defaultsBlock = paramKeys.map((k) => `  ${k} ??= ${literal(params[k]!.default)};`).join('\n');
  const preambleBlock = (rule.preamble ?? []).map((line) => `  ${line}`).join('\n');
  const polygonBlock =
    `  const profile_pts = [\n` +
    (rule.polygon ?? []).map((p) => `    ${p},`).join('\n') +
    `\n  ];`;
  const segArg = paramKeys.includes('segments') ? 'p.segments' : '96';
  const ret = `  return r_revolve(profile_pts, ${segArg});`;
  const body = `\n${defaultsBlock}\n${preambleBlock ? preambleBlock + '\n' : ''}${polygonBlock}\n${ret}\n`;
  return src.replace(headRe, `${head}${body}${tail}`);
}

/** Replace a scaffolded part's `params: { … }` + signature with the vocab's. */
function overridePartParams(src: string, partId: string, params: Record<string, VocabParam>): string {
  const paramKeys = Object.keys(params);
  // Just the brace block — spliceMetaField will prepend `params: `.
  const paramsBlock =
    '{\n' +
    paramKeys.map((k) => {
      const p = params[k]!;
      const fields: string[] = [];
      fields.push(`label: '${p.label ?? k}'`);
      if (p.min  != null) fields.push(`min: ${p.min}`);
      if (p.max  != null) fields.push(`max: ${p.max}`);
      if (p.step != null) fields.push(`step: ${p.step}`);
      const def = typeof p.default === 'string' ? `'${p.default}'` : p.default;
      fields.push(`default: ${def}`);
      if (p.unit) fields.push(`unit: '${p.unit}'`);
      return `    ${k}: { ${fields.join(', ')} },`;
    }).join('\n') +
    '\n  }';
  // Splice into meta — find existing `params: { … }` and replace via
  // balanced brace scan (regex would mis-handle nested braces).
  src = spliceMetaField(src, 'params', paramsBlock);
  // Replace the function signature with the new positional arg list.
  src = src.replace(
    new RegExp(`(export\\s+function\\s+${partId}\\s*\\()([^)]*)(\\))`),
    `$1${paramKeys.join(', ')}$3`,
  );
  return src;
}

/** Rewrite the .rev.ts body's `profile_pts = …` initializer + the final
 *  `r_revolve(…)` call to use `resolveProfile({ kind, params })`. */
function rewriteRevBodyToFunctionProfile(
  src: string,
  partId: string,
  rule: VocabPrimitiveRule,
  params: Record<string, VocabParam>,
): string {
  const paramKeys = Object.keys(params);
  // Build the `params: {…}` literal mapping profile-side keys → expressions.
  const mapEntries = Object.entries(rule.profile_params_map ?? {})
    .map(([profileKey, expr]) => `${profileKey}: ${expr}`)
    .join(', ');
  // Replace the body's profile_pts construction + r_revolve call.
  // The scaffold has shape:
  //   export function id(args…) { defaults… const profile_pts = […]; return r_revolve(profile_pts, ?); }
  const headRe = new RegExp(`(export\\s+function\\s+${partId}\\s*\\([^)]*\\)\\s*\\{)([\\s\\S]*?)(\\n\\}\\s*$)`);
  const m = src.match(headRe);
  if (!m) return src;
  const head = m[1]!, tail = m[3]!;
  const defaultsBlock = paramKeys.map((k) => `  ${k} ??= ${literal(params[k]!.default)};`).join('\n');
  const profileLine = `  const profile_pts = resolveProfile({ kind: '${rule.template}', params: { ${mapEntries} } });`;
  // Use `segments` if it's a vocab param, otherwise 96.
  const segArg = paramKeys.includes('segments') ? 'p.segments' : '96';
  const ret = `  return r_revolve(profile_pts, ${segArg});`;
  const body = `\n${defaultsBlock}\n${profileLine}\n${ret}\n`;
  return src.replace(headRe, `${head}${body}${tail}`);
}

// ─── Compose (.asm.ts) ─────────────────────────────────────────────────

function translateAsm(entry: VocabEntry, vocab: Vocabulary, partId: string, traceTag: any): string {
  const rule = entry.rule as VocabComposeRule;
  if (rule.kind !== 'compose') throw new Error('translateAsm: rule.kind must be "compose"');

  // Resolve imports — each `term` maps to a deployed part id (the exemplar
  // of that vocabulary entry). Errors propagate if the term is unknown.
  const imports: ImportDef[] = (rule.imports ?? []).map((imp) => {
    const childEntry = vocab.terms[imp.term];
    if (!childEntry) throw new Error(`translateAsm: import term "${imp.term}" not in vocabulary (alias ${imp.alias})`);
    return { name: imp.alias, src: childEntry.exemplar };
  });

  // Build the empty asm scaffold then apply the composition tree + params.
  let src = buildAssemblySource(partId);
  const root = treeFromRuleNode(rule.composition, vocab, rule.imports);
  src = applyToSource(src, partId, imports, root);
  for (const [name, p] of Object.entries(entry.params)) {
    src = addAssemblyParam(src, partId, {
      name,
      label: p.label ?? name,
      min:   p.min,
      max:   p.max,
      step:  p.step,
      default: typeof p.default === 'number' ? p.default : Number(p.default) || 0,
    });
  }
  src = injectTraceTag(src, traceTag);
  return src;
}

/** Recursive rule-node → TreeNode. The rule schema uses a JSON-friendly
 *  shape; this expands to the runtime composition-tree IR. */
function treeFromRuleNode(node: any, vocab: Vocabulary, imports: Array<{ alias: string; term: string }>): TreeNode {
  if (!node || typeof node !== 'object') throw new Error('treeFromRuleNode: node is not an object');
  switch (node.type) {
    case 'call': {
      // Resolve paramKeys: look up the child term's params (from the alias)
      // to get the canonical ordering. The rule's `args` is an object
      // {paramKey: expression}; we align it to the child's param order.
      const alias = node.fn;
      const importEntry = imports.find((i) => i.alias === alias);
      const childTerm = importEntry ? vocab.terms[importEntry.term] : undefined;
      const childKeys = childTerm ? Object.keys(childTerm.params) : Object.keys(node.args ?? {});
      const argsObj: Record<string, any> = node.args ?? {};
      const args: TreeNode[] = childKeys.map((k) => {
        const v = argsObj[k];
        // If the rule didn't provide a value for this param, leave it as the
        // child's DEFAULT (hidden — per Q1 param_lifting:"hidden" decision).
        const raw = v != null ? String(v) : (childTerm && literal(childTerm.params[k]!.default));
        return { type: 'literal', id: newNodeId(), value: String(raw ?? '0') };
      });
      const callNode: TreeNode = {
        type: 'call', id: newNodeId(), fn: alias,
        args, paramKeys: childKeys,
      };
      return callNode;
    }
    case 'method': {
      return {
        type: 'method', id: newNodeId(),
        op: node.op,
        obj: treeFromRuleNode(node.obj, vocab, imports),
        arg: treeFromRuleNode(node.arg, vocab, imports),
      };
    }
    case 'list': {
      return {
        type: 'list', id: newNodeId(),
        children: (node.children ?? []).map((c: any) => treeFromRuleNode(c, vocab, imports)),
      };
    }
    case 'stack': {
      // Sequential end-to-end mate via manifold-helpers.stack() — each
      // child's head lands on the prior child's tail at runtime. Avoids
      // the tail(A) compose-rule footgun where A is the import alias
      // (a function) rather than a manifold instance.
      return {
        type: 'stack', id: newNodeId(),
        children: (node.children ?? []).map((c: any) => treeFromRuleNode(c, vocab, imports)),
      };
    }
    case 'mv': {
      const child = treeFromRuleNode(node.child, vocab, imports);
      const ox = String(node.offset_x ?? 0);
      const oy = String(node.offset_y ?? 0);
      const oz = String(node.offset_z ?? 0);
      return {
        type: 'mv', id: newNodeId(),
        child,
        offset: [
          { type: 'literal', id: newNodeId(), value: ox },
          { type: 'literal', id: newNodeId(), value: oy },
          { type: 'literal', id: newNodeId(), value: oz },
        ],
      };
    }
    case 'repeat': {
      // Defer to Phase 4 (with K.54 visual repeat block). For now, throw —
      // surfaces the unsupported shape clearly.
      throw new Error('treeFromRuleNode: "repeat" node not yet supported (K.54 / K.68 Phase 4)');
    }
    default:
      throw new Error(`treeFromRuleNode: unknown node type "${node.type}"`);
  }
}

// ─── Compose (.asm.ts) — K.63 graph emit path (Phase 14) ─────────────
//
// Same VocabComposeRule input as translateAsm, different output: emits
// `meta.graph` (the new editor's data model) instead of the legacy text
// body. The body is the machine-generated projection — what /graph-editor
// re-emits whenever the user changes the graph. Loading this part in
// /graph-editor produces the same canvas state as building it interactively.

function translateAsmGraph(entry: VocabEntry, vocab: Vocabulary, partId: string, traceTag: any): string {
  const rule = entry.rule as VocabComposeRule;
  if (rule.kind !== 'compose') throw new Error('translateAsmGraph: rule.kind must be "compose"');

  // 1. Start fresh + add assembly params first so wired args can reference them.
  let g: Graph = newGraph();
  for (const [name, p] of Object.entries(entry.params)) {
    g = gAddParam(g, name, {
      label: p.label ?? name,
      min: p.min,
      max: p.max,
      step: p.step,
      default: typeof p.default === 'number' ? p.default : Number(p.default) || 0,
      unit: p.unit,
    });
  }

  // 2. Build a map alias → exemplar id so calls resolve their import.
  const aliasToSrc = new Map<string, string>();
  for (const imp of rule.imports ?? []) {
    const childEntry = vocab.terms[imp.term];
    if (!childEntry) throw new Error(`translateAsmGraph: import term "${imp.term}" not in vocabulary (alias ${imp.alias})`);
    aliasToSrc.set(imp.alias, childEntry.exemplar);
  }

  // 3. Walk the composition tree, building Graph nodes as we go.
  const built = ruleToGraph(g, rule.composition, rule.imports, vocab, aliasToSrc);
  g = built.graph;

  // 4. Emit + trace-tag.
  const { source } = emitGraph(g, { id: partId, description: entry.definition });
  return injectTraceTag(source, traceTag);
}

/** Recursive vocab-rule-node → Graph builder. Returns the new graph + the
 *  ID of the node that was just added (so the parent can wire to it).
 *
 *  Call nodes: aliased to the rule's import alias (A, B, …) — overriding
 *  addCall's auto-generated alias to keep the user-facing labels matching
 *  the vocabulary entry.
 *  Method nodes: dropped as placeholders, then setMethodInput wires obj+arg
 *  AFTER the children are built. The downside (a brief intermediate state
 *  where the method points at empty ids) is invisible — only the final
 *  graph is observable. */
function ruleToGraph(
  g: Graph,
  node: any,
  imports: Array<{ alias: string; term: string }>,
  vocab: Vocabulary,
  aliasToSrc: Map<string, string>,
  parentId?: NodeId,
): { graph: Graph; nodeId: NodeId } {
  if (!node || typeof node !== 'object') throw new Error('ruleToGraph: node is not an object');
  switch (node.type) {
    case 'call': {
      const alias = node.fn;
      const src = aliasToSrc.get(alias) ?? alias;
      const importEntry = imports.find((i) => i.alias === alias);
      const childTerm = importEntry ? vocab.terms[importEntry.term] : undefined;
      const childKeys = childTerm ? Object.keys(childTerm.params) : Object.keys(node.args ?? {});
      const argsObj: Record<string, any> = node.args ?? {};
      const args: Record<string, ArgValue> = {};
      for (const k of childKeys) {
        const v = argsObj[k];
        const raw = v != null ? String(v) : (childTerm ? String(childTerm.params[k]!.default) : '0');
        args[k] = exprOrLiteralOrParam(raw);
      }
      const r = addCall(g, src, args, parentId);
      // Override the auto-generated alias to match the rule's import alias.
      const callNode = r.graph.nodes[r.id];
      if (callNode && callNode.type === 'call') {
        callNode.alias = alias;
      }
      return { graph: r.graph, nodeId: r.id };
    }
    case 'method': {
      const op = node.op as CsgOp;
      // Build children at the SAME parent as the method — method.obj/arg are
      // by-reference, not by-containment. Both children + the method end up
      // as siblings under parentId; output filtering keeps the method as
      // visible + hides the children (they're consumed by the method).
      const objR = ruleToGraph(g, node.obj, imports, vocab, aliasToSrc, parentId);
      const argR = ruleToGraph(objR.graph, node.arg, imports, vocab, aliasToSrc, parentId);
      const mAdded = addMethod(argR.graph, op, objR.nodeId, argR.nodeId, parentId);
      return { graph: mAdded.graph, nodeId: mAdded.id };
    }
    case 'list': {
      // Build the children flat at parentId (the graph's root list is
      // already a list — we don't need a nested container for a top-level
      // list rule). Returns the LAST built nodeId as the "rooted" anchor.
      let g2 = g; let lastId: NodeId | null = null;
      for (const child of node.children ?? []) {
        const r = ruleToGraph(g2, child, imports, vocab, aliasToSrc, parentId);
        g2 = r.graph; lastId = r.nodeId;
      }
      if (!lastId) {
        // Empty list — produce a placeholder container so emit doesn't crash.
        const c = addContainer(g2, 'list', parentId);
        return { graph: c.graph, nodeId: c.id };
      }
      return { graph: g2, nodeId: lastId };
    }
    case 'stack': {
      // Sequential end-to-end mate via manifold-helpers.stack() — each
      // child's head lands on the prior child's tail at runtime. Graph
      // model: the stack is a Container node whose `type` is 'stack';
      // the emit pattern (in composition-emit.ts) renders it as
      // `stack(child1, child2, ...)`. Output-filter (computeConsumedSet)
      // marks stack children as consumed, so they don't pollute the return.
      const stackR = addContainer(g, 'stack', parentId);
      let g2 = stackR.graph;
      for (const child of node.children ?? []) {
        const cr = ruleToGraph(g2, child, imports, vocab, aliasToSrc, stackR.id);
        g2 = cr.graph;
      }
      return { graph: g2, nodeId: stackR.id };
    }
    case 'mv': {
      // Build the child first so we have its id (same parentId — sibling).
      const childR = ruleToGraph(g, node.child, imports, vocab, aliasToSrc, parentId);
      const ox = exprOrLiteralOrParam(String(node.offset_x ?? 0));
      const oy = exprOrLiteralOrParam(String(node.offset_y ?? 0));
      const oz = exprOrLiteralOrParam(String(node.offset_z ?? 0));
      const m = addMv(childR.graph, childR.nodeId, [ox, oy, oz], parentId);
      return { graph: m.graph, nodeId: m.id };
    }
    case 'repeat': {
      // Instantiate the child N times + stack via end-to-end mate. Count is
      // typed as ArgValue so it survives as a literal, param wire, or
      // expression (e.g. `p.n`, 3, or `p.layers * 2`). The vocab rule's
      // `mate: 'tail(prev)'` field is the default semantic of stack() —
      // nothing extra to encode for now (future repeats with custom mate
      // points would extend this).
      const childR = ruleToGraph(g, node.child, imports, vocab, aliasToSrc, parentId);
      const count  = exprOrLiteralOrParam(String(node.count ?? 1));
      const r = addRepeat(childR.graph, childR.nodeId, count, parentId);
      return { graph: r.graph, nodeId: r.id };
    }
    default:
      throw new Error(`ruleToGraph: unknown node type "${node.type}"`);
  }
}

/** Classify an arg expression string into the right ArgValue shape:
 *    "1.5" / "0"   → literal number
 *    "p.foo"        → wired param (param chip)
 *    anything else  → expression (e.g. "p.od / 2 - p.wall", "Math.PI/4")
 *  Pure literals MUST round-trip via `Number(str)` (no NaN) AND the trimmed
 *  string MUST look like a number to avoid mis-classifying `'A'` etc. as 0. */
function exprOrLiteralOrParam(raw: string): ArgValue {
  const s = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!isNaN(n)) return asLiteral(n);
  }
  const pm = /^p\.([a-zA-Z_]\w*)$/.exec(s);
  if (pm) return asParam(pm[1]!);
  return asExpr(s);
}

// ─── Trace tag + helpers ───────────────────────────────────────────────

function injectTraceTag(src: string, tag: { term: string; vocab_version: string; rule_hash: string }): string {
  const tagLiteral = `generated_from: { term: '${tag.term}', vocab_version: '${tag.vocab_version}', rule_hash: '${tag.rule_hash}' }`;
  return insertMetaField(src, tagLiteral);
}

/** Insert a field at the top of `meta = { … }`. Does not de-dupe — the
 *  caller is responsible for not double-applying. */
function insertMetaField(src: string, fieldLiteral: string): string {
  // Find `export const meta = {` and inject right after the opening brace.
  const m = src.match(/(export\s+const\s+meta\s*=\s*\{)/);
  if (!m) return src;
  const pos = (m.index ?? 0) + m[0].length;
  return src.slice(0, pos) + `\n  ${fieldLiteral},` + src.slice(pos);
}

/** Replace a top-level `meta.<field>: { … }` block with a new value. */
function spliceMetaField(src: string, field: string, newValue: string): string {
  const re = new RegExp(`\\b${field}\\s*:\\s*\\{`);
  const m = src.match(re);
  if (!m) return src;
  const start = (m.index ?? 0) + m[0].length - 1; // points AT the `{`
  let depth = 0, i = start;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  if (depth !== 0) return src;
  return src.slice(0, m.index!) + `${field}: ${newValue}` + src.slice(i);
}

/** Format a default value as a JS literal. Strings → quoted; numbers → number. */
function literal(v: number | string | undefined): string {
  if (v == null) return '0';
  if (typeof v === 'number') return String(v);
  return `'${v}'`;
}

/** Stable djb2 hash for a rule object (for the trace tag). */
function hashRule(rule: any): string {
  const s = JSON.stringify(rule);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
