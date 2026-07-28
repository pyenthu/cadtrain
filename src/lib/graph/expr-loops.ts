/**
 * expr-loops.ts — parse a `list<point>` output formula into a STRUCTURED LOOP
 * form (for the visual "FOR block" editor) and serialize it back. Recognizes the
 * canonical shapes the editor produces:
 *   • single  `map(range(s, e), f(i) = BODY)`
 *   • joined  `concat(map(...), map(...), …)`
 *   • multi-line named helpers + a `return` join:
 *       outer(i) = BODY
 *       inner(j) = BODY
 *       return concat(map(range(0,N), outer), map(range(0,N), inner))
 *
 * Anything it can't structure → `null` (the editor falls back to raw text). The
 * round-trip is the contract: serializeLoops(parseLoops(f)) re-parses to the same
 * loops. Pure + DOM-free. Plan: the loop-block visualization (#11 readability).
 */
import { parseExpr } from '$lib/graph/graph-exprs';

/** One FOR loop — an iterator over a range producing a per-element body. */
export interface LoopBlock {
  varName: string;   // the iterator (i, j, …)
  start: string;     // range start expr (text), default '0'
  stop: string;      // range stop expr (text), e.g. 'NPts'
  body: string;      // the per-element expr (text), e.g. '[R*cos(t), R*sin(t)]'
}
/** A list output structured as one or more loops, concat-joined when > 1. */
export interface LoopForm { loops: LoopBlock[]; }

function nodeStr(n: any): string { try { return n?.toString() ?? ''; } catch { return ''; } }

/** A `range(stop)` | `range(start, stop)` FunctionNode → its bounds, or null. */
function asRange(n: any): { start: string; stop: string } | null {
  if (n?.type !== 'FunctionNode' || n.fn?.name !== 'range') return null;
  const args = n.args ?? [];
  if (args.length === 1) return { start: '0', stop: nodeStr(args[0]) };
  if (args.length === 2) return { start: nodeStr(args[0]), stop: nodeStr(args[1]) };
  return null;
}

/** A `map(range(...), fn)` FunctionNode → a LoopBlock. `fn` is either an inline
 *  `f(i) = body` (FunctionAssignmentNode) or a SymbolNode naming a helper. */
function mapToLoop(n: any, helpers: Map<string, any>): LoopBlock | null {
  if (n?.type !== 'FunctionNode' || n.fn?.name !== 'map') return null;
  const [rangeArg, fnArg] = n.args ?? [];
  const rng = asRange(rangeArg);
  if (!rng) return null;
  let varName: string; let bodyNode: any;
  if (fnArg?.type === 'FunctionAssignmentNode') {
    varName = (fnArg.params ?? [])[0] ?? 'i';
    bodyNode = fnArg.expr;
  } else if (fnArg?.type === 'SymbolNode' && helpers.has(fnArg.name)) {
    const h = helpers.get(fnArg.name);
    varName = (h.params ?? [])[0] ?? 'i';
    bodyNode = h.expr;
  } else return null;
  return { varName, start: rng.start, stop: rng.stop, body: nodeStr(bodyNode) };
}

/** Parse a list formula into structured loops, or null if it isn't a recognized
 *  loop shape (the editor then keeps showing raw text). */
export function parseLoops(formula: string): LoopForm | null {
  if (!formula || !formula.trim()) return null;
  const parsed = parseExpr(formula.replace(/\breturn\b/g, ' ')); // strip return sugar
  if (!parsed.ok) return null;
  const ast: any = parsed.ast;

  // Gather named helpers (multi-line form) + locate the RESULT expression.
  const helpers = new Map<string, any>();
  let result: any = ast;
  if (ast.type === 'BlockNode') {
    const stmts = (ast.blocks ?? []).map((b: any) => b.node);
    for (const s of stmts) if (s.type === 'FunctionAssignmentNode') helpers.set(s.name, s);
    result = stmts[stmts.length - 1];
    if (result?.type === 'FunctionAssignmentNode') return null; // no result expr
  }

  // result = concat(map, map, …) | a single map(…)
  let mapNodes: any[];
  if (result?.type === 'FunctionNode' && result.fn?.name === 'concat') mapNodes = result.args ?? [];
  else if (result?.type === 'FunctionNode' && result.fn?.name === 'map') mapNodes = [result];
  else return null;

  const loops: LoopBlock[] = [];
  for (const m of mapNodes) {
    const lp = mapToLoop(m, helpers);
    if (!lp) return null; // any unrecognized arm → bail to text
    loops.push(lp);
  }
  return loops.length ? { loops } : null;
}

/** Serialize structured loops back to a formula. One loop → an inline
 *  `map(range, f(i)=body)`; many → the multi-line named-helper + concat form
 *  (readable + the exact shape parseLoops re-reads). */
export function serializeLoops(form: LoopForm): string {
  const loops = form.loops ?? [];
  if (loops.length === 0) return '';
  if (loops.length === 1) {
    const l = loops[0]!;
    return `map(range(${l.start}, ${l.stop}), f(${l.varName}) = ${l.body})`;
  }
  const helpers = loops.map((l, k) => `loop${k}(${l.varName}) = ${l.body}`);
  const maps = loops.map((l, k) => `map(range(${l.start}, ${l.stop}), loop${k})`);
  return [...helpers, `return concat(${maps.join(', ')})`].join('\n');
}
