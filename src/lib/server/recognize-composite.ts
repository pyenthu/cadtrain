/**
 * recognize-composite — parse a composite primitive's source.ts and
 * recognize its individual PARTS (instances) for the GUI.
 *
 * The dual-control model: source.ts is the source of truth; the GUI
 * introspects it to show per-part rows. This is the recognizer. It reads
 * the composite pattern:
 *
 *     const A = r_cylinder(od, length, 64);
 *     const B = mv(r_extrude(profile, height), [0, 0, -off]);
 *     return A.add(B);
 *
 * → instances [{ name:'A', call:'r_cylinder', argsText, transforms:[] },
 *              { name:'B', call:'r_extrude', argsText, transforms:[{op:'mv',…}] }]
 *   composition: "A.add(B)"
 *
 * Parsed with a REAL AST (acorn) — NOT regex. The split-grammar approach
 * was abandoned once for JSON because its regex recognizer was fooled by
 * comments; acorn parses properly. TS type annotations are stripped first
 * via esbuild (acorn is JS-only).
 *
 * Statements that don't fit the `const NAME = <call>` instance pattern
 * (loops, conditionals, helpers) are COUNTED as `unrecognized` — they're
 * the "opaque code" escape hatch: still valid + still run in the sandbox,
 * just not decomposed into rows. Leaves (no instances) recognize empty.
 */
import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import { usesOf } from './primitive-loader';

export interface RecognizedTransform { op: string; argsText: string; }
export interface RecognizedInstance {
  name: string;
  call: string;
  argsText: string;
  transforms: RecognizedTransform[];
}
export interface RecognizedComposite {
  /** All recognized `const NAME = <call>(...)` instances. */
  instances: RecognizedInstance[];
  /** The composite's declared deps (meta.uses). A recognized instance is
   *  a true PART when its `call` is in this set; instances calling the
   *  weld toolkit (weldAndBuild, …) are leaf locals, not parts. */
  uses: string[];
  composition: string | null;
  unrecognized: number;
}

const OPERATORS = new Set(['mv', 'rot']);

export function recognizeComposite(source: string): RecognizedComposite {
  // Strip TS types so acorn (JS-only) can parse.
  const js = transformSync(source, { loader: 'ts', format: 'esm' }).code;
  const ast: any = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  const slice = (n: any) => js.slice(n.start, n.end);

  // Find the geom function — an exported (or bare) FunctionDeclaration.
  let fn: any = null;
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') { fn = node; break; }
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
      fn = node.declaration; break;
    }
  }
  const uses = usesOf(source);
  if (!fn) return { instances: [], uses, composition: null, unrecognized: 0 };

  const instances: RecognizedInstance[] = [];
  let composition: string | null = null;
  let unrecognized = 0;

  for (const stmt of fn.body.body) {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id?.type !== 'Identifier' || !d.init) { unrecognized++; continue; }
        // Unwrap mv/rot operator calls (outer → inner) to find the
        // primitive call at the core.
        let node: any = d.init;
        const transforms: RecognizedTransform[] = [];
        while (node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && OPERATORS.has(node.callee.name)) {
          transforms.push({ op: node.callee.name, argsText: node.arguments.slice(1).map(slice).join(', ') });
          node = node.arguments[0];
        }
        if (node?.type === 'CallExpression' && node.callee?.type === 'Identifier') {
          instances.push({ name: d.id.name, call: node.callee.name, argsText: node.arguments.map(slice).join(', '), transforms });
        } else {
          unrecognized++;
        }
      }
    } else if (stmt.type === 'ReturnStatement' && stmt.argument) {
      composition = slice(stmt.argument);
    } else {
      unrecognized++;
    }
  }
  return { instances, uses, composition, unrecognized };
}
