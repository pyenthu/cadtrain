/**
 * PartsMapKind — the `list<part>` PRODUCER (#38 Phase 3, the payoff of the
 * complex-params schema). Maps a `list<record>` param to N part INSTANCES via ONE
 * node — the geometry-valued sibling of the `list<point>` expression builder.
 *
 *   emit  → `Array.from(<rows>, (<s>, i) => <src>({ …argMap }))`, wrapped by `op`
 *           (`list` = bare array | `stack(…)` | `place(…)`).
 *   validate → the `list` ArgValue + each `argMap` value are missing-param checked
 *              (mirrors CallKind); a blank `src` is flagged.
 *   size  → header + one row per mapped arg + the "+ arg" row (mirrors RepeatKind).
 *
 * Marked a LIST PRODUCER (op:'list') by computeListProducers so a parent Stack
 * `...`-spreads its N results, exactly like a Repeat with op:'list'. Its `src` is
 * also added to `meta.uses` in emitGraph so the loader fetches the template part.
 *
 * The `argMap` values reference the per-row binding `s` (default loopVar) and the
 * index `i` through `expr` ArgValues (`{kind:'expr', expr:'s.od'}`) — the SAME
 * pattern RepeatKind uses for its `i`-referencing bindings. Field access into a
 * record row is therefore emitted verbatim by `ctx.emitValue`, needing no
 * ArgValue change.
 */
import type { PartsMapNode } from '../../composition-graph-types';
import { type NodeKind, type ValidationError, err, checkArg } from '../node-kind';

/** A JS identifier we allow as a loop-var name; anything else falls back to 's'. */
const IDENT = /^[A-Za-z_$][\w$]*$/;

export const PartsMapKind: NodeKind<PartsMapNode> = {
  type: 'parts_map',
  emitExpr: (node, c) => {
    const rows = c.emitValue(node.list);
    const s = IDENT.test(String(node.loopVar || '')) ? String(node.loopVar) : 's';
    // Object-style call — `src({ argName: <value>, … })`. The argMap values reach
    // the row via `expr` ArgValues (`s.od`) resolved by ctx.emitValue.
    const call = c.emitCall(node.src, node.argMap ?? {});
    const array = `Array.from(${rows}, (${s}, i) => ${call})`;
    const op = node.op ?? 'list';
    if (op === 'stack') return `stack(${array})`;
    if (op === 'place') return `place(${array})`;
    return array;
  },
  validate: (node, g) => {
    const errs: ValidationError[] = [];
    // A blank `src` can't instantiate a part — surface it as a missing-node so the
    // editor greys the card (no template selected yet).
    if (!node.src || typeof node.src !== 'string') {
      errs.push(err(node.id, 'src', String(node.src ?? ''), 'missing-node'));
    }
    // The rows source + every mapped arg are missing-param checked (a param whose
    // row/field was deleted surfaces as an orphaned slot), exactly like a Call arg.
    errs.push(...checkArg(node.id, 'list', node.list, g));
    for (const [k, v] of Object.entries(node.argMap ?? {})) {
      errs.push(...checkArg(node.id, `argMap.${k}`, v, g));
    }
    return errs;
  },
  // The rows come from a PARAM (or an expr), NOT a graph node, so a parts_map
  // consumes no node inputs — its `list<geometry>` output is a root/stack child.
  inputRefs: () => [],
  size: (node, ctx) => {
    // Header (title + "one <src> per row") + one row per mapped arg + a "+ arg"
    // row — mirrors RepeatKind's per-part row growth above a 110px floor.
    const args = Object.keys(node.argMap ?? {}).length;
    return { w: ctx.width, h: Math.max(110, 64 + (args + 1) * 24) };
  },
  sockets: (node) => ({ inputs: ['list', ...Object.keys(node.argMap ?? {})], output: true }),
};
