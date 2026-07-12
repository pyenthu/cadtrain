/**
 * RepeatKind — instantiate a child N times, combined per `op`
 * (`stack` default | `list` | `place`). The fat one: it folds per-part + global
 * mv/rot modifier stacks, patterned bindings (loop-var scope), and a raw
 * `bodyExpr` code override — all VERBATIM from the switch arm.
 *   emit  ← composition-emit.ts:642 (the whole `case 'repeat':`, incl. inline foldMods)
 *   validate ← :158 (empty-body / children / count / modifiers / bindings, in order)
 *   size  ← geom.ts:371 ({ w, max(110, 64 + (parts+1)*24) } — header + one row per part)
 */
import type { RepeatNode } from '../../composition-graph-types';
import { type NodeKind, type ValidationError, has, err, checkArg } from '../node-kind';

export const RepeatKind: NodeKind<RepeatNode> = {
  type: 'repeat',
  emitExpr: (node, c) => {
    // Instantiate the child N times. The `op` field decides how the N
    // copies are combined:
    //   'stack' (default) — mate end-to-end via stack()
    //   'list'            — bare array; caller decides
    //   'place'           — combine without mating (overlap at origin)
    // Default 'stack' so existing graphs without an op field keep the
    // historical drilling-string idiom (every BUILD_ORDER part works).
    const count = c.emitValue(node.count);
    // Fold an mv/rot modifier stack around an expression, innermost-first
    // (modifiers[0] closest to the part). Axis values may reference i/N/binds.
    const foldMods = (expr: string, ms: any[]): string => {
      let e = expr;
      for (const m of (ms ?? [])) {
        const fn = m?.kind === 'rot' ? 'rot' : 'mv';
        const v = (m?.vec ?? []) as any[];
        e = `${fn}(${e}, [${c.emitValue(v[0])}, ${c.emitValue(v[1])}, ${c.emitValue(v[2])}])`;
      }
      return e;
    };
    // The repeated UNIT: each part is wrapped in its OWN partModifiers stack,
    // then the parts combine per-iteration via place([...]) (compose — each
    // keeps its own position); a single part with no per-part mods emits bare
    // so legacy parts stay byte-identical. A raw `bodyExpr` (code mode)
    // overrides the children-derived body verbatim.
    const partMods: Record<string, any[]> = ((node as any).partModifiers ?? {}) as any;
    const anyPartMods = Object.values(partMods).some((m) => Array.isArray(m) && m.length > 0);
    const parts = (node.children ?? []).map((ch, i) => foldMods(c.ref(ch, `children[${i}]`), partMods[ch]));
    const rawBody = typeof (node as any).bodyExpr === 'string' ? (node as any).bodyExpr.trim() : '';
    const child = rawBody
      ? rawBody
      : parts.length === 1 ? parts[0] : `place([${parts.join(', ')}])`;
    // Patterned repeat (#7): GLOBAL per-copy transforms keyed to the loop var.
    const mods: any[] = Array.isArray((node as any).modifiers) ? (node as any).modifiers : [];
    const rawBinds: any[] = Array.isArray((node as any).bindings) ? (node as any).bindings : [];
    const binds = rawBinds.filter((b) => b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name));
    const hasLoopVar = typeof (node as any).loopVar === 'string' && (node as any).loopVar.length > 0;
    let array: string;
    if (mods.length === 0 && binds.length === 0 && !hasLoopVar && !rawBody && !anyPartMods) {
      // Backward-compat: identity clone, byte-identical to the historical form.
      array = `Array.from({ length: ${count} }, () => ${child})`;
    } else {
      const loopVar = /^[A-Za-z_$][\w$]*$/.test(String((node as any).loopVar || ''))
        ? String((node as any).loopVar) : 'i';
      const bindLines = binds.map((b) => `const ${b.name} = ${c.emitValue(b.value)};`).join(' ');
      // Inject the loop count under BOTH `N` (historical) and `NPts` (the name
      // poly_repeat/sketch_repeat use), so a binding expr like `i*turns*tau/NPts`
      // works identically across all three repeat flavors.
      const preamble = bindLines
        ? `const N = ${count}; const NPts = ${count}; ${bindLines}`
        : `const N = ${count}; const NPts = ${count};`;
      // Global modifiers wrap the whole place([…]) unit (per-part mods are
      // already folded inside each part). Innermost-first.
      const body = foldMods(child, mods);
      array = `Array.from({ length: ${count} }, (_, ${loopVar}) => { ${preamble} return ${body}; })`;
    }
    const op = node.op ?? 'stack';
    if (op === 'list')  return array;
    if (op === 'place') return `place(${array})`;
    return `stack(${array})`;
  },
  validate: (node, g) => {
    const errs: ValidationError[] = [];
    // A bodyExpr (code mode) supplies the body without wired parts, so an
    // empty PARTS list is only an error when there is no code override.
    const hasBody = typeof (node as any).bodyExpr === 'string' && (node as any).bodyExpr.trim().length > 0;
    const kids = node.children ?? [];
    if (kids.length === 0 && !hasBody) {
      errs.push(err(node.id, 'child', '', 'missing-node'));
    }
    kids.forEach((ch, i) => {
      if (!has(g, ch)) errs.push(err(node.id, `children[${i}]`, ch, 'missing-node'));
    });
    errs.push(...checkArg(node.id, 'count', node.count, g));
    // Patterned-repeat modifier/binding ArgValues (#7) — same as poly_repeat.
    ((node as any).modifiers as any[] ?? []).forEach((m, k) =>
      (m?.vec ?? []).forEach((v: any, ax: number) =>
        errs.push(...checkArg(node.id, `modifiers[${k}].vec[${ax}]`, v, g))));
    ((node as any).bindings as any[] ?? []).forEach((b, k) =>
      errs.push(...checkArg(node.id, `bindings[${k}].value`, b?.value, g)));
    return errs;
  },
  inputRefs: (n) => [...(n.children ?? [])],
  size: (node, ctx) => {
    // Header (title + "builds a list of N ×") + one row per PART + a "+ part"
    // row. Single-part repeats keep the historical 110px height.
    const parts = (node.children?.length ?? 0);
    return { w: ctx.width, h: Math.max(110, 64 + (parts + 1) * 24) };
  },
  sockets: (n) => ({ inputs: (n.children ?? []).map((_, i) => `children[${i}]`), output: true }),
};
