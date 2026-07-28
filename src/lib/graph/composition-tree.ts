/**
 * composition-tree — the data layer for K.63 .asm.ts assemblies.
 *
 * An assembly is THREE things:
 *   * meta.params (existing) — the assembly's inputs.
 *   * meta.imports — aliases binding short names to primitives. Pure declarations.
 *   * meta.composition — a SINGLE tagged-union TreeNode root that produces the
 *                         final geometry. The function body is auto-generated
 *                         from imports + composition. Tree is the source of truth.
 *
 * All tree mutations are IMMUTABLE — replaceNode / deleteNode / wrapNode /
 * moveNode return new tree roots, never mutate in place. (Svelte's reactivity
 * relies on identity changes; mutations would otherwise miss the diff.)
 */

import { partHashId } from '$lib/graph/part-id';

// ─── Types ──────────────────────────────────────────────────────────────

export type NodeType =
  | 'call' | 'method' | 'list' | 'stack' | 'overlay' | 'mv' | 'rot' | 'ref' | 'literal';

export type CsgOp = 'add' | 'subtract' | 'intersect';
export type Datum = 'head' | 'tail' | 'center';

interface NodeBase { id: string; name?: string; }

/**
 * NOTE on Call inline transforms: a Call node can carry optional `mv` and
 * `rot` triplets. Emit wraps the Call in mv(...) / rot(...) when set —
 * mv inner, rot outer — so the canonical emission with both set is
 *   rot(mv(fn(arg1, arg2), [...]), [...])
 * The standalone Mv / Rot folder nodes still exist for the rare case of
 * transforming a multi-child group; the inline form is the common case
 * for transforming a single leaf and keeps the tree flat.
 */
export type TreeNode =
  | (NodeBase & { type: 'call';    fn: string; args: TreeNode[];
                  /** When present, emit as object form `fn({k1: arg1, k2: arg2, ...})`
                   *  with `paramKeys[i]` keying `args[i]`. Set on every Call inserted
                   *  via the new editor flow; omitted only for hand-written legacy
                   *  positional Calls. */
                  paramKeys?: string[];
                  mv?: [TreeNode, TreeNode, TreeNode]; rot?: [TreeNode, TreeNode, TreeNode] })
  | (NodeBase & { type: 'method';  obj: TreeNode; op: CsgOp; arg: TreeNode })
  | (NodeBase & { type: 'list';    children: TreeNode[] })
  | (NodeBase & { type: 'stack';   children: TreeNode[] })
  | (NodeBase & { type: 'overlay'; anchor: TreeNode; child: TreeNode; at: Datum })
  | (NodeBase & { type: 'mv';      child: TreeNode; offset: [TreeNode, TreeNode, TreeNode] })
  | (NodeBase & { type: 'rot';     child: TreeNode; rot:    [TreeNode, TreeNode, TreeNode] })
  | (NodeBase & { type: 'ref';     target: string })
  | (NodeBase & { type: 'literal'; value: string });

export interface ImportDef { name: string; src: string; }

// ─── Node id generator ──────────────────────────────────────────────────

/** Short stable id (8 alpha chars). Stable enough for editing identity;
 *  not cryptographic. Mirrors a UUID's role without the 36-char weight. */
export function newNodeId(): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 8; i++) out += alpha[Math.floor(Math.random() * 26)];
  return out;
}

// ─── Walkers ────────────────────────────────────────────────────────────

/** Depth-first walk, pre-order. Visits every node in the tree exactly once. */
export function walkTree(root: TreeNode | null, fn: (node: TreeNode) => void): void {
  if (!root) return;
  fn(root);
  for (const child of childrenOf(root)) walkTree(child, fn);
}

/** All direct child nodes of a node (treating arg slots, args[], children[],
 *  obj/arg of method, anchor/child of overlay, etc. uniformly). */
export function childrenOf(node: TreeNode): TreeNode[] {
  switch (node.type) {
    case 'call': {
      const out = [...node.args];
      if (node.mv) out.push(...node.mv);
      if (node.rot) out.push(...node.rot);
      return out;
    }
    case 'method':  return [node.obj, node.arg];
    case 'list':
    case 'stack':   return node.children;
    case 'overlay': return [node.anchor, node.child];
    case 'mv':      return [node.child, ...node.offset];
    case 'rot':     return [node.child, ...node.rot];
    case 'ref':
    case 'literal': return [];
  }
}

/** Find a node by id, anywhere in the tree. */
export function findNode(root: TreeNode | null, id: string): TreeNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  for (const c of childrenOf(root)) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Find a node's parent + which slot it occupies (so the editor can splice
 *  it). For array slots (args / children / offset / rot), `index` is set. */
export interface NodeLocation {
  parent: TreeNode;
  slot: 'args' | 'children' | 'obj' | 'arg' | 'anchor' | 'child' | 'offset' | 'rot' | 'mvInline' | 'rotInline';
  index?: number;
}
export function findParent(root: TreeNode | null, id: string): NodeLocation | null {
  if (!root) return null;
  switch (root.type) {
    case 'call':
      for (let i = 0; i < root.args.length; i++) {
        if (root.args[i]!.id === id) return { parent: root, slot: 'args', index: i };
        const deep = findParent(root.args[i]!, id);
        if (deep) return deep;
      }
      if (root.mv) {
        for (let i = 0; i < 3; i++) {
          if (root.mv[i]!.id === id) return { parent: root, slot: 'mvInline', index: i };
          const deep = findParent(root.mv[i]!, id);
          if (deep) return deep;
        }
      }
      if (root.rot) {
        for (let i = 0; i < 3; i++) {
          if (root.rot[i]!.id === id) return { parent: root, slot: 'rotInline', index: i };
          const deep = findParent(root.rot[i]!, id);
          if (deep) return deep;
        }
      }
      return null;
    case 'method':
      if (root.obj.id === id) return { parent: root, slot: 'obj' };
      if (root.arg.id === id) return { parent: root, slot: 'arg' };
      return findParent(root.obj, id) ?? findParent(root.arg, id);
    case 'list':
    case 'stack':
      for (let i = 0; i < root.children.length; i++) {
        if (root.children[i]!.id === id) return { parent: root, slot: 'children', index: i };
        const deep = findParent(root.children[i]!, id);
        if (deep) return deep;
      }
      return null;
    case 'overlay':
      if (root.anchor.id === id) return { parent: root, slot: 'anchor' };
      if (root.child.id === id) return { parent: root, slot: 'child' };
      return findParent(root.anchor, id) ?? findParent(root.child, id);
    case 'mv': {
      if (root.child.id === id) return { parent: root, slot: 'child' };
      for (let i = 0; i < 3; i++) {
        if (root.offset[i]!.id === id) return { parent: root, slot: 'offset', index: i };
      }
      return findParent(root.child, id);
    }
    case 'rot': {
      if (root.child.id === id) return { parent: root, slot: 'child' };
      for (let i = 0; i < 3; i++) {
        if (root.rot[i]!.id === id) return { parent: root, slot: 'rot', index: i };
      }
      return findParent(root.child, id);
    }
    case 'ref':
    case 'literal':
      return null;
  }
}

// ─── Immutable transforms ───────────────────────────────────────────────

/** Return a clone of `root` with the node at `id` replaced by `replacement`. */
export function replaceNode(root: TreeNode, id: string, replacement: TreeNode): TreeNode {
  if (root.id === id) return replacement;
  switch (root.type) {
    case 'call':
      return { ...root,
        args: root.args.map((a) => replaceNode(a, id, replacement)),
        ...(root.mv ? { mv: root.mv.map((o) => replaceNode(o, id, replacement)) as [TreeNode, TreeNode, TreeNode] } : {}),
        ...(root.rot ? { rot: root.rot.map((o) => replaceNode(o, id, replacement)) as [TreeNode, TreeNode, TreeNode] } : {}),
      };
    case 'method':
      return { ...root, obj: replaceNode(root.obj, id, replacement), arg: replaceNode(root.arg, id, replacement) };
    case 'list':
    case 'stack':
      return { ...root, children: root.children.map((c) => replaceNode(c, id, replacement)) };
    case 'overlay':
      return { ...root, anchor: replaceNode(root.anchor, id, replacement), child: replaceNode(root.child, id, replacement) };
    case 'mv':
      return { ...root, child: replaceNode(root.child, id, replacement),
        offset: root.offset.map((o) => replaceNode(o, id, replacement)) as [TreeNode, TreeNode, TreeNode] };
    case 'rot':
      return { ...root, child: replaceNode(root.child, id, replacement),
        rot: root.rot.map((o) => replaceNode(o, id, replacement)) as [TreeNode, TreeNode, TreeNode] };
    case 'ref':
    case 'literal':
      return root;
  }
}

/** Return a clone of `root` with the node at `id` removed. Returns null
 *  when the root itself is the target. For array slots, splices out;
 *  for single slots, replaces with an empty literal placeholder. */
export function deleteNode(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return null;
  const placeholder = (): TreeNode => ({ type: 'literal', id: newNodeId(), value: '' });
  switch (root.type) {
    case 'call':
      return { ...root,
        args: root.args.filter((a) => a.id !== id).map((a) => deleteOrKeep(a, id) ?? placeholder()),
        ...(root.mv ? { mv: root.mv.map((o) => o.id === id ? placeholder() : (deleteOrKeep(o, id) ?? placeholder())) as [TreeNode, TreeNode, TreeNode] } : {}),
        ...(root.rot ? { rot: root.rot.map((o) => o.id === id ? placeholder() : (deleteOrKeep(o, id) ?? placeholder())) as [TreeNode, TreeNode, TreeNode] } : {}),
      };
    case 'method':
      return {
        ...root,
        obj: root.obj.id === id ? placeholder() : (deleteOrKeep(root.obj, id) ?? placeholder()),
        arg: root.arg.id === id ? placeholder() : (deleteOrKeep(root.arg, id) ?? placeholder()),
      };
    case 'list':
    case 'stack':
      return { ...root, children: root.children.filter((c) => c.id !== id).map((c) => deleteOrKeep(c, id) ?? placeholder()) };
    case 'overlay':
      return {
        ...root,
        anchor: root.anchor.id === id ? placeholder() : (deleteOrKeep(root.anchor, id) ?? placeholder()),
        child:  root.child.id  === id ? placeholder() : (deleteOrKeep(root.child,  id) ?? placeholder()),
      };
    case 'mv':
      return {
        ...root,
        child: root.child.id === id ? placeholder() : (deleteOrKeep(root.child, id) ?? placeholder()),
        offset: root.offset.map((o) => o.id === id ? placeholder() : (deleteOrKeep(o, id) ?? placeholder())) as [TreeNode, TreeNode, TreeNode],
      };
    case 'rot':
      return {
        ...root,
        child: root.child.id === id ? placeholder() : (deleteOrKeep(root.child, id) ?? placeholder()),
        rot: root.rot.map((o) => o.id === id ? placeholder() : (deleteOrKeep(o, id) ?? placeholder())) as [TreeNode, TreeNode, TreeNode],
      };
    case 'ref':
    case 'literal':
      return root;
  }
}
function deleteOrKeep(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return null;
  const next = deleteNode(node, id);
  return next ?? node;
}

// ─── Body emit ──────────────────────────────────────────────────────────

/** Emit the `const A = shaft;` declarations from the imports list. */
export function emitImports(imports: readonly ImportDef[]): string {
  return imports.map((i) => `  const ${i.name} = ${i.src};`).join('\n');
}

/** Emit a single TreeNode as a JS expression. Recursive. */
export function emitNode(node: TreeNode): string {
  switch (node.type) {
    case 'call': {
      // Object-form when paramKeys present — `B({k1: v1, k2: v2})`. Each arg slot
      // is visibly tied to its named child param in the source, so the user can
      // wire any expression (`p.od`, `5`, `p.od - 2*p.wall`) into a known slot.
      // Falls back to positional `B(v1, v2)` only for legacy hand-authored Calls
      // (paramKeys undefined).
      let expr: string;
      if (node.paramKeys && node.paramKeys.length) {
        const parts = node.paramKeys.map((k, i) => {
          const v = node.args[i];
          return v ? `${k}: ${emitNode(v)}` : `${k}: 0`;
        });
        expr = `${node.fn}({ ${parts.join(', ')} })`;
      } else {
        expr = `${node.fn}(${node.args.map(emitNode).join(', ')})`;
      }
      // mv inner, rot outer — composes as `rot(mv(<call>, [...]), [...])`.
      if (node.mv) expr = `mv(${expr}, [${node.mv.map(emitNode).join(', ')}])`;
      if (node.rot) expr = `rot(${expr}, [${node.rot.map(emitNode).join(', ')}])`;
      // STAMP per-instance hashId so analyzeAssembly's LUT keyed by
      // partHashId(alias) matches the bake's mesh-relation originalIDs.
      // Without this, K.63 assemblies bake as one fused colour and the
      // CompositionEditor swatches do nothing.
      if (node.fn) expr = `__tag(${expr}, ${partHashId(node.fn)})`;
      return expr;
    }
    case 'method':  return `${emitNode(node.obj)}.${node.op}(${emitNode(node.arg)})`;
    case 'list':    return `[${node.children.map(emitNode).join(', ')}]`;
    case 'stack':   return `stack([${node.children.map(emitNode).join(', ')}])`;
    case 'overlay': return `overlay(${emitNode(node.anchor)}, ${emitNode(node.child)}, ${JSON.stringify(node.at)})`;
    case 'mv':      return `mv(${emitNode(node.child)}, [${node.offset.map(emitNode).join(', ')}])`;
    case 'rot':     return `rot(${emitNode(node.child)}, [${node.rot.map(emitNode).join(', ')}])`;
    case 'ref':     return node.target;
    case 'literal': return node.value || '0';
  }
}

/** Emit the assembly function body — imports first, then `return <composition>;`. */
export function emitAssemblyBody(imports: readonly ImportDef[], root: TreeNode | null): string {
  const importLines = emitImports(imports);
  const body: string[] = [];
  if (importLines) body.push(importLines);
  if (!root) {
    body.push('  return empty();');
  } else {
    body.push(`  return ${emitNode(root)};`);
  }
  return '\n' + body.join('\n') + '\n';
}

// ─── Source-level read / write ──────────────────────────────────────────

/** Find the balanced `{...}` literal for a top-level meta key like
 *  `composition:`, `imports:`. Returns the span (start at first `{` or
 *  `[`, end one past matching close). null when missing or malformed. */
function findValueRange(source: string, key: string): { start: number; end: number } | null {
  const re = new RegExp(`\\b${key}\\s*:\\s*([\\[{])`);
  const m = source.match(re);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length - 1;
  const open = m[1]!;
  const close = open === '[' ? ']' : '}';
  let depth = 0, i = start;
  let inStr: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return { start, end: i + 1 }; }
    i++;
  }
  return null;
}

/** Parse a JS object literal that may contain nested objects, arrays,
 *  strings (single or double quoted), numbers, booleans, null. Used for
 *  meta.composition and meta.imports — both deterministic emit shapes. */
class LitParser {
  pos = 0;
  constructor(public src: string) {}
  ws(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }
  peek(): string { return this.src[this.pos]!; }
  parse(): unknown {
    this.ws();
    const ch = this.peek();
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    if (ch === '"' || ch === "'") return this.string();
    if (ch === '-' || /[\d.]/.test(ch)) return this.number();
    if (this.src.startsWith('null',  this.pos)) { this.pos += 4; return null; }
    if (this.src.startsWith('true',  this.pos)) { this.pos += 4; return true; }
    if (this.src.startsWith('false', this.pos)) { this.pos += 5; return false; }
    throw new Error(`unexpected token at ${this.pos}: '${ch}'`);
  }
  object(): Record<string, unknown> {
    if (this.src[this.pos] !== '{') throw new Error('expected {');
    this.pos++;
    const out: Record<string, unknown> = {};
    this.ws();
    while (this.pos < this.src.length && this.src[this.pos] !== '}') {
      const key = this.key();
      this.ws();
      if (this.src[this.pos] !== ':') throw new Error(`expected : at ${this.pos}`);
      this.pos++;
      out[key] = this.parse();
      this.ws();
      if (this.src[this.pos] === ',') this.pos++;
      this.ws();
    }
    if (this.src[this.pos] !== '}') throw new Error('expected }');
    this.pos++;
    return out;
  }
  array(): unknown[] {
    if (this.src[this.pos] !== '[') throw new Error('expected [');
    this.pos++;
    const out: unknown[] = [];
    this.ws();
    while (this.pos < this.src.length && this.src[this.pos] !== ']') {
      out.push(this.parse());
      this.ws();
      if (this.src[this.pos] === ',') this.pos++;
      this.ws();
    }
    if (this.src[this.pos] !== ']') throw new Error('expected ]');
    this.pos++;
    return out;
  }
  key(): string {
    this.ws();
    if (this.peek() === '"' || this.peek() === "'") return this.string();
    const start = this.pos;
    while (this.pos < this.src.length && /[a-zA-Z0-9_$]/.test(this.src[this.pos]!)) this.pos++;
    return this.src.slice(start, this.pos);
  }
  string(): string {
    const q = this.src[this.pos]!;
    this.pos++;
    let out = '';
    while (this.pos < this.src.length && this.src[this.pos] !== q) {
      if (this.src[this.pos] === '\\') {
        const next = this.src[this.pos + 1];
        if (next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else if (next === '\\') out += '\\';
        else if (next === q) out += q;
        else out += this.src[this.pos] + (next ?? '');
        this.pos += 2;
      } else {
        out += this.src[this.pos];
        this.pos++;
      }
    }
    this.pos++;
    return out;
  }
  number(): number {
    const start = this.pos;
    if (this.src[this.pos] === '-') this.pos++;
    while (this.pos < this.src.length && /[\d.eE+-]/.test(this.src[this.pos]!)) this.pos++;
    return Number(this.src.slice(start, this.pos));
  }
}

/** Parse meta.imports → typed list. Returns [] when missing or malformed. */
export function parseImports(source: string): ImportDef[] {
  const range = findValueRange(source, 'imports');
  if (!range) return [];
  try {
    const value = new LitParser(source.slice(range.start, range.end)).parse();
    if (!Array.isArray(value)) return [];
    return value
      .filter((r): r is { name: string; src: string } => !!r && typeof r === 'object' && 'name' in r && 'src' in r && typeof (r as any).name === 'string' && typeof (r as any).src === 'string')
      .map((r) => ({ name: r.name, src: r.src }));
  } catch { return []; }
}

/** Parse meta.dependencies → Map<id, paramKeys[]>. Dependencies snapshot the
 *  upstream primitive's parameter list (in order) at the time the assembly
 *  was last saved. Used by the editor to label positional Call args with
 *  the corresponding parameter names. Missing / malformed → empty Map. */
export function parseDependencyParamKeys(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const range = findValueRange(source, 'dependencies');
  if (!range) return out;
  try {
    const value = new LitParser(source.slice(range.start, range.end)).parse();
    if (!Array.isArray(value)) return out;
    for (const row of value) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as any).id;
      const keys = (row as any).paramKeys;
      if (typeof id === 'string' && Array.isArray(keys) && keys.every((k) => typeof k === 'string')) {
        out.set(id, keys);
      }
    }
  } catch { /* tolerate */ }
  return out;
}

/** Parse meta.composition → TreeNode. Returns null when missing / null / malformed. */
export function parseComposition(source: string): TreeNode | null {
  const range = findValueRange(source, 'composition');
  if (!range) {
    // A literal `composition: null` (no braces) is also valid — check raw.
    const m = source.match(/\bcomposition\s*:\s*null\b/);
    return m ? null : null;
  }
  try {
    const value = new LitParser(source.slice(range.start, range.end)).parse();
    return value ? rehydrateNode(value) : null;
  } catch { return null; }
}

/** Validate + rehydrate a parsed JS literal into a TreeNode. Assigns ids
 *  to any nodes missing one (so older or hand-authored sources work). */
function rehydrateNode(raw: unknown): TreeNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = o.type as NodeType | undefined;
  if (!type) return null;
  const id = typeof o.id === 'string' ? o.id : newNodeId();
  const name = typeof o.name === 'string' ? o.name : undefined;
  switch (type) {
    case 'call': {
      const fn = typeof o.fn === 'string' ? o.fn : '';
      const args = Array.isArray(o.args) ? o.args.map((a) => rehydrateNode(a)).filter((x): x is TreeNode => !!x) : [];
      const paramKeys = Array.isArray((o as any).paramKeys)
        ? (o as any).paramKeys.filter((k: unknown): k is string => typeof k === 'string')
        : undefined;
      const readTriplet = (raw: unknown): [TreeNode, TreeNode, TreeNode] | undefined => {
        if (!Array.isArray(raw)) return undefined;
        const arr = raw.slice(0, 3).map((v) => rehydrateNode(v)).filter((x): x is TreeNode => !!x);
        while (arr.length < 3) arr.push({ type: 'literal', id: newNodeId(), value: '0' });
        return arr as [TreeNode, TreeNode, TreeNode];
      };
      const mv = readTriplet((o as any).mv);
      const rot = readTriplet((o as any).rot);
      return { type, id, name, fn, args,
        ...(paramKeys && paramKeys.length ? { paramKeys } : {}),
        ...(mv ? { mv } : {}), ...(rot ? { rot } : {}) };
    }
    case 'method': {
      const op = (['add', 'subtract', 'intersect'].includes(o.op as string) ? o.op : 'subtract') as CsgOp;
      const obj = rehydrateNode(o.obj);
      const arg = rehydrateNode(o.arg);
      if (!obj || !arg) return null;
      return { type, id, name, obj, op, arg };
    }
    case 'list':
    case 'stack': {
      const children = Array.isArray(o.children) ? o.children.map((c) => rehydrateNode(c)).filter((x): x is TreeNode => !!x) : [];
      return { type, id, name, children };
    }
    case 'overlay': {
      const at = (['head', 'tail', 'center'].includes(o.at as string) ? o.at : 'head') as Datum;
      const anchor = rehydrateNode(o.anchor);
      const child  = rehydrateNode(o.child);
      if (!anchor || !child) return null;
      return { type, id, name, anchor, child, at };
    }
    case 'mv':
    case 'rot': {
      const child = rehydrateNode(o.child);
      if (!child) return null;
      const arr = (o as any)[type === 'mv' ? 'offset' : 'rot'];
      const xyz = Array.isArray(arr)
        ? (arr.slice(0, 3).map((v) => rehydrateNode(v)).filter((x): x is TreeNode => !!x))
        : [];
      while (xyz.length < 3) xyz.push({ type: 'literal', id: newNodeId(), value: '0' });
      if (type === 'mv') return { type, id, name, child, offset: xyz as [TreeNode, TreeNode, TreeNode] };
      else return { type, id, name, child, rot: xyz as [TreeNode, TreeNode, TreeNode] };
    }
    case 'ref': {
      const target = typeof o.target === 'string' ? o.target : '';
      return { type, id, name, target };
    }
    case 'literal': {
      const value = typeof o.value === 'string' ? o.value : (typeof o.value === 'number' ? String(o.value) : '');
      return { type, id, name, value };
    }
  }
}

/** Serialize an imports array as the value for `imports:`. */
export function serializeImports(imports: readonly ImportDef[]): string {
  if (imports.length === 0) return '[]';
  return '[\n' + imports.map((i) => `    { name: ${JSON.stringify(i.name)}, src: ${JSON.stringify(i.src)} }`).join(',\n') + ',\n  ]';
}

/** Serialize a TreeNode as the value for `composition:`. Pretty-printed
 *  with 2-space-per-level indent so the file stays human-readable. */
export function serializeComposition(root: TreeNode | null, indent = 2): string {
  if (!root) return 'null';
  return serializeNode(root, indent);
}
function serializeNode(node: TreeNode, indent: number): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  const parts: string[] = [];
  parts.push(`type: ${JSON.stringify(node.type)}`);
  parts.push(`id: ${JSON.stringify(node.id)}`);
  if (node.name) parts.push(`name: ${JSON.stringify(node.name)}`);
  switch (node.type) {
    case 'call':
      parts.push(`fn: ${JSON.stringify(node.fn)}`);
      parts.push(`args: [${node.args.length ? '\n' + inner + node.args.map((a) => serializeNode(a, indent + 2)).join(',\n' + inner) + '\n' + pad : ''}]`);
      if (node.paramKeys && node.paramKeys.length) {
        parts.push(`paramKeys: [${node.paramKeys.map((k) => JSON.stringify(k)).join(', ')}]`);
      }
      if (node.mv)  parts.push(`mv: [${node.mv.map((o) => serializeNode(o, indent + 2)).join(', ')}]`);
      if (node.rot) parts.push(`rot: [${node.rot.map((o) => serializeNode(o, indent + 2)).join(', ')}]`);
      break;
    case 'method':
      parts.push(`op: ${JSON.stringify(node.op)}`);
      parts.push(`obj: ${serializeNode(node.obj, indent + 2)}`);
      parts.push(`arg: ${serializeNode(node.arg, indent + 2)}`);
      break;
    case 'list':
    case 'stack':
      parts.push(`children: [${node.children.length ? '\n' + inner + node.children.map((c) => serializeNode(c, indent + 2)).join(',\n' + inner) + '\n' + pad : ''}]`);
      break;
    case 'overlay':
      parts.push(`at: ${JSON.stringify(node.at)}`);
      parts.push(`anchor: ${serializeNode(node.anchor, indent + 2)}`);
      parts.push(`child: ${serializeNode(node.child, indent + 2)}`);
      break;
    case 'mv':
      parts.push(`child: ${serializeNode(node.child, indent + 2)}`);
      parts.push(`offset: [${node.offset.map((o) => serializeNode(o, indent + 2)).join(', ')}]`);
      break;
    case 'rot':
      parts.push(`child: ${serializeNode(node.child, indent + 2)}`);
      parts.push(`rot: [${node.rot.map((o) => serializeNode(o, indent + 2)).join(', ')}]`);
      break;
    case 'ref':
      parts.push(`target: ${JSON.stringify(node.target)}`);
      break;
    case 'literal':
      parts.push(`value: ${JSON.stringify(node.value)}`);
      break;
  }
  return '{\n' + inner + parts.join(',\n' + inner) + '\n' + pad + '}';
}

// ─── Source-level write (splice imports + composition + uses + body) ────

/** Compute meta.uses from imports + any direct Call.fn names that AREN'T
 *  themselves an import alias. The loader needs the SOURCE primitive id;
 *  an alias (`A`) resolves to its src (`shaft`) via the emitted
 *  `const A = shaft;` and is therefore NOT a dep itself. */
export function inferUses(imports: readonly ImportDef[], root: TreeNode | null): string[] {
  const aliasNames = new Set(imports.map((i) => i.name));
  const seen = new Set<string>();
  for (const imp of imports) if (imp.src) seen.add(imp.src);
  walkTree(root, (n) => {
    if (n.type === 'call' && !aliasNames.has(n.fn)) seen.add(n.fn);
  });
  return [...seen];
}

/** Replace `meta.imports: …`'s value in source. Inserts the field after
 *  `tags: [...]` if absent. */
export function writeImports(source: string, imports: readonly ImportDef[]): string {
  const literal = serializeImports(imports);
  const range = findValueRange(source, 'imports');
  if (range) return source.slice(0, range.start) + literal + source.slice(range.end);
  return insertMetaField(source, 'imports', literal);
}

/** Replace `meta.composition: …`'s value. Handles the `null` case. */
export function writeComposition(source: string, root: TreeNode | null): string {
  const literal = serializeComposition(root, 2);
  const range = findValueRange(source, 'composition');
  if (range) return source.slice(0, range.start) + literal + source.slice(range.end);
  // Look for the `composition: null` shape.
  const m = source.match(/(\bcomposition\s*:\s*)null/);
  if (m && m[1]) {
    const start = (m.index ?? 0) + m[1].length;
    return source.slice(0, start) + literal + source.slice(start + 4);
  }
  return insertMetaField(source, 'composition', literal);
}

/** Replace `uses: [...]` in source. */
export function writeUses(source: string, uses: readonly string[]): string {
  const literal = '[' + uses.map((u) => `'${u}'`).join(', ') + ']';
  const m = source.match(/(\buses\s*:\s*)\[[^\]]*\]/);
  if (m && m[1]) {
    const start = (m.index ?? 0) + m[1].length;
    const end = (m.index ?? 0) + m[0].length;
    return source.slice(0, start) + literal + source.slice(end);
  }
  return insertMetaField(source, 'uses', literal);
}

function insertMetaField(source: string, key: string, value: string): string {
  // Insert after `tags: [...]` as a stable anchor; fall back to after `name:`.
  const tagsM = source.match(/(\btags\s*:\s*\[[^\]]*\]\s*,)/);
  if (tagsM) {
    const at = (tagsM.index ?? 0) + tagsM[0].length;
    return source.slice(0, at) + `\n  ${key}: ${value},` + source.slice(at);
  }
  const nameM = source.match(/(\bname\s*:\s*['"][^'"]*['"]\s*,)/);
  if (nameM) {
    const at = (nameM.index ?? 0) + nameM[0].length;
    return source.slice(0, at) + `\n  ${key}: ${value},` + source.slice(at);
  }
  return source;
}

/** Replace the body of `export function ID() { ... }` with newBody. */
export function rewriteAssemblyFunctionBody(source: string, id: string, newBody: string): string {
  // Tolerate function-name vs id mismatch (file got renamed but the body's
  // `export function <name>` lagged): try id-named first, then fall back to
  // the FIRST exported function declaration. Mirrors the same tolerance the
  // loader applies in primitive-loader.ts; without it, applyToSource silently
  // returns source unchanged for renamed assemblies and the Auto-wire / save
  // path appears to do nothing.
  let fnRe = new RegExp(`(export\\s+function\\s+${id}\\s*\\([^)]*\\)\\s*\\{)`);
  let m = source.match(fnRe);
  if (!m) {
    const anyFn = source.match(/(export\s+function\s+\w+\s*\([^)]*\)\s*\{)/);
    if (anyFn) m = anyFn;
  }
  if (!m) return source;
  const headEnd = (m.index ?? 0) + m[0].length;
  let depth = 1, i = headEnd;
  let inStr: string | null = null;
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  if (depth !== 0) return source;
  return source.slice(0, headEnd) + newBody + source.slice(i);
}

/** Spec for an assembly param entry — same shape as primitive params.
 *  The editor uses this to add a knob the assembly can drive into its
 *  child Calls. */
export interface AssemblyParamSpec {
  name: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

/** Splice a new param entry into the assembly source — adds the row to
 *  `meta.params { ... }` AND the param name to the function signature.
 *  Returns the new source text. Idempotent — re-adding an existing name
 *  is a no-op. */
export function addAssemblyParam(source: string, id: string, spec: AssemblyParamSpec): string {
  const name = spec.name.trim();
  if (!/^[a-zA-Z_$][\w$]*$/.test(name)) return source;
  // Collision check against meta.params keys.
  const range = findValueRange(source, 'params');
  if (range) {
    const inside = source.slice(range.start + 1, range.end - 1);
    const hadKey = new RegExp(`(^|[\\s,{])${name}\\s*:`).test(inside);
    if (hadKey) return source;
  }
  const label = spec.label ?? name;
  const min = spec.min ?? 0, max = spec.max ?? 10, step = spec.step ?? 0.1, def = spec.default ?? 1;
  const entry = `${name}: { label: '${label}', min: ${min}, max: ${max}, step: ${step}, default: ${def} }`;
  // Insert into meta.params block (before the closing brace). The function
  // signature stays `(p)` — the object-arg style means meta.params keys
  // surface only on `p` at runtime, never on the signature itself.
  let out = source;
  if (range) {
    const inside = out.slice(range.start + 1, range.end - 1);
    const hasElems = inside.trim().length > 0;
    // Insert just before the closing brace.
    const closePos = range.end - 1;
    const sep = hasElems ? ', ' : '';
    out = out.slice(0, closePos) + `${sep}${entry}` + out.slice(closePos);
  } else {
    // No params block — synthesize one after the tags / name anchor.
    out = insertMetaField(out, 'params', `{ ${entry} }`);
  }
  return out;
}

/** Remove a param entry from the assembly source — both the meta.params
 *  row AND the matching signature token. No-op when the name isn't
 *  present. */
export function removeAssemblyParam(source: string, id: string, name: string): string {
  if (!/^[a-zA-Z_$][\w$]*$/.test(name)) return source;
  let out = source;
  // Drop from meta.params block. Match `<name>: { ... }` with one adjacent
  // comma (leading or trailing) — same idea as PrimitiveView's spanWithComma.
  // The function signature stays `(p)`; no signature edit needed.
  const rowRe = new RegExp(`\\b${name}\\s*:\\s*\\{[^}]*\\}\\s*,?\\s*`);
  out = out.replace(rowRe, '');
  // Tidy a stray leading comma left by removing the first entry.
  out = out.replace(/params\s*:\s*\{\s*,/, 'params: {');
  return out;
}

/** One-shot: apply imports + composition mutations + sync uses + re-emit
 *  the body, returning the new source text. The canonical mutation path
 *  for the editor — every edit goes through here. */
export function applyToSource(
  source: string,
  id: string,
  imports: readonly ImportDef[],
  root: TreeNode | null,
): string {
  let out = writeImports(source, imports);
  out = writeComposition(out, root);
  out = writeUses(out, inferUses(imports, root));
  out = rewriteAssemblyFunctionBody(out, id, emitAssemblyBody(imports, root));
  return out;
}
