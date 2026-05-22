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
 * → instances [{ name:'A', call:'r_cylinder', argsText, argsStart, argsEnd,
 *                transforms:[] },
 *              { name:'B', call:'r_extrude', …, transforms:[{op:'mv',…}] }]
 *   composition: "A.add(B)"
 *
 * Parsed with a REAL AST (acorn) — NOT regex. We parse the ORIGINAL source
 * so node positions (argsStart/argsEnd) map back to it → the GUI can
 * round-trip arg EDITS by splicing the source at those offsets. If the
 * source has TS type syntax acorn can't handle (e.g. `: number` param
 * annotations), we fall back to a type-stripped parse — read-only, since
 * the positions no longer map to the original (`editable: false`). Keep
 * composite sources annotation-free to stay editable.
 *
 * Statements that don't fit the `const NAME = <call>` instance pattern
 * (loops, conditionals, helpers) are COUNTED as `unrecognized` — the
 * "opaque code" escape hatch. Leaves (no instances) recognize empty.
 */
import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import { usesOf } from './primitive-loader';

export interface RecognizedTransform {
  op: string;
  argsText: string;
  argsStart: number;
  argsEnd: number;
}
export interface RecognizedInstance {
  name: string;
  call: string;
  argsText: string;
  argsStart: number;
  argsEnd: number;
  transforms: RecognizedTransform[];
}
export interface RecognizedParam {
  /** Param name (object-literal key inside meta.params). */
  name: string;
  /** Whether the param declares `type: 'polygon'`. */
  polygon: boolean;
  /** Offsets of this param's `default:` VALUE expression in the source, so the
   *  popup can splice a new polygon literal over a promoted param's default
   *  (-1 when not found / no default). */
  defaultStart: number;
  defaultEnd: number;
}
export interface RecognizedComposite {
  instances: RecognizedInstance[];
  uses: string[];
  composition: string | null;
  unrecognized: number;
  /** True when the ORIGINAL source parsed directly → argsStart/argsEnd map
   *  to it and arg edits can round-trip. False when we had to type-strip
   *  first → positions don't map → GUI shows the rows read-only. */
  editable: boolean;
  /** Source offsets the "Load primitive" action splices at (original
   *  source; -1 when absent / not editable). returnStart: insert the new
   *  `const X = …` line before the return. comp{Start,End}: the return's
   *  expression span (wrapped with `.add(X)`). usesInsertPos / usesHasElems:
   *  append `'<id>'` to the meta.uses array. */
  returnStart: number;
  compStart: number;
  compEnd: number;
  usesInsertPos: number;
  usesHasElems: boolean;
  /** "Promote inline profile → named param" support. The meta.params object's
   *  append point (insert a new `name: {…}` entry); the function signature's
   *  append point (add a positional param name); plus every declared param so
   *  the popup can tell a literal arg from a param-ref + locate a promoted
   *  param's default value to edit it. All -1 / [] when not editable. */
  paramsInsertPos: number;
  paramsHasElems: boolean;
  sigInsertPos: number;
  sigHasParams: boolean;
  params: RecognizedParam[];
}

const OPERATORS = new Set(['mv', 'rot']);

export function recognizeComposite(source: string): RecognizedComposite {
  const uses = usesOf(source);

  // Parse the original first (positions map back); fall back to a
  // type-stripped parse for read-only recognition.
  let js = source;
  let editable = true;
  let ast: any;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    editable = false;
    js = transformSync(source, { loader: 'ts', format: 'esm' }).code;
    ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  }
  const slice = (n: any) => js.slice(n.start, n.end);

  // Locate the meta.uses array → where the Load action appends a new id.
  // While here, also locate meta.params (where Promote appends a new param
  // entry) and enumerate the declared params (so the popup can distinguish a
  // literal-array arg from a param-ref + find a promoted param's default).
  let usesInsertPos = -1, usesHasElems = false;
  let paramsInsertPos = -1, paramsHasElems = false;
  const params: RecognizedParam[] = [];
  for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id?.type === 'Identifier' && d.id.name === 'meta' && d.init?.type === 'ObjectExpression') {
        const up = d.init.properties.find((p: any) => (p.key?.name ?? p.key?.value) === 'uses');
        if (up?.value?.type === 'ArrayExpression') {
          const els = up.value.elements;
          if (els.length) { usesInsertPos = els[els.length - 1].end; usesHasElems = true; }
          else { usesInsertPos = up.value.start + 1; usesHasElems = false; }
        }
        const pp = d.init.properties.find((p: any) => (p.key?.name ?? p.key?.value) === 'params');
        if (pp?.value?.type === 'ObjectExpression') {
          const props = pp.value.properties;
          if (props.length) { paramsInsertPos = props[props.length - 1].end; paramsHasElems = true; }
          else { paramsInsertPos = pp.value.start + 1; paramsHasElems = false; }
          for (const prop of props) {
            const pname = prop.key?.name ?? prop.key?.value;
            if (pname == null || prop.value?.type !== 'ObjectExpression') continue;
            const typeProp = prop.value.properties.find((q: any) => (q.key?.name ?? q.key?.value) === 'type');
            const isPoly = typeProp?.value?.value === 'polygon';
            const defProp = prop.value.properties.find((q: any) => (q.key?.name ?? q.key?.value) === 'default');
            params.push({
              name: String(pname),
              polygon: isPoly,
              defaultStart: defProp?.value ? defProp.value.start : -1,
              defaultEnd: defProp?.value ? defProp.value.end : -1,
            });
          }
        }
      }
    }
  }

  let returnStart = -1, compStart = -1, compEnd = -1;
  let sigInsertPos = -1, sigHasParams = false;

  let fn: any = null;
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') { fn = node; break; }
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
      fn = node.declaration; break;
    }
  }
  if (!fn) return { instances: [], uses, composition: null, unrecognized: 0, editable, returnStart, compStart, compEnd, usesInsertPos, usesHasElems, paramsInsertPos, paramsHasElems, sigInsertPos, sigHasParams, params };

  // Function signature append point — where Promote adds a positional param.
  // After the last param's end, or just inside `(` for a no-arg signature.
  if (fn.params.length) { sigInsertPos = fn.params[fn.params.length - 1].end; sigHasParams = true; }
  else {
    // No params: find the `(` after the function name (before the body `{`).
    const openParen = js.indexOf('(', fn.id ? fn.id.end : fn.start);
    sigInsertPos = openParen >= 0 ? openParen + 1 : -1;
    sigHasParams = false;
  }

  // Args span = first arg start → last arg end (the text inside the parens,
  // commas included). `fromIndex` skips the wrapped manifold for mv/rot.
  const argsSpan = (call: any, fromIndex = 0) => {
    const args = call.arguments.slice(fromIndex);
    if (args.length === 0) return { start: -1, end: -1, txt: '' };
    const start = args[0].start, end = args[args.length - 1].end;
    return { start, end, txt: js.slice(start, end) };
  };

  const instances: RecognizedInstance[] = [];
  let composition: string | null = null;
  let unrecognized = 0;

  for (const stmt of fn.body.body) {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id?.type !== 'Identifier' || !d.init) { unrecognized++; continue; }
        let node: any = d.init;
        const transforms: RecognizedTransform[] = [];
        while (node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && OPERATORS.has(node.callee.name)) {
          const sp = argsSpan(node, 1);
          transforms.push({ op: node.callee.name, argsText: sp.txt, argsStart: sp.start, argsEnd: sp.end });
          node = node.arguments[0];
        }
        if (node?.type === 'CallExpression' && node.callee?.type === 'Identifier') {
          const sp = argsSpan(node, 0);
          instances.push({ name: d.id.name, call: node.callee.name, argsText: sp.txt, argsStart: sp.start, argsEnd: sp.end, transforms });
        } else {
          unrecognized++;
        }
      }
    } else if (stmt.type === 'ReturnStatement' && stmt.argument) {
      composition = slice(stmt.argument);
      returnStart = stmt.start;
      compStart = stmt.argument.start;
      compEnd = stmt.argument.end;
    } else {
      unrecognized++;
    }
  }
  return { instances, uses, composition, unrecognized, editable, returnStart, compStart, compEnd, usesInsertPos, usesHasElems, paramsInsertPos, paramsHasElems, sigInsertPos, sigHasParams, params };
}
