/**
 * Client-side tool dispatcher for Claude-assisted authoring.
 * Imports no Svelte internals — the spec reference is injected via setSpec().
 * Each tool mutates the spec directly and returns a human-readable result
 * string that gets fed back to Claude as a tool_result.
 *
 * DO NOT import from server routes — this is browser-only.
 */

import { COMPONENTS } from '$lib/components/library';
import type { AuthoredComponent, AuthoredPart, AuthoredOp } from './schema';

let _spec: AuthoredComponent | null = null;
let _onSpecChanged: (() => void) | null = null;

/**
 * Bind the tool dispatcher to a live spec reference. Call once from the
 * author page at mount time. The optional onChange callback lets the page
 * trigger reactivity after a tool mutates the spec (e.g. re-assign to
 * force Svelte to notice the change).
 */
export function setSpec(spec: AuthoredComponent, onChange?: () => void) {
  _spec = spec;
  _onSpecChanged = onChange ?? null;
}

function spec(): AuthoredComponent {
  if (!_spec) throw new Error('Tool dispatcher not initialized — call setSpec() first');
  return _spec;
}

function changed() {
  _onSpecChanged?.();
}

function nextPartId(): string {
  const s = spec();
  let n = 0;
  while (s.parts.some((p) => p.id === `p${n}`)) n++;
  return `p${n}`;
}

function nextOpId(): string {
  const s = spec();
  let n = 0;
  while (s.ops.some((o) => o.out === `op${n}`)) n++;
  return `op${n}`;
}

// ═══ TOOL IMPLEMENTATIONS ═══

const TOOL_IMPLS: Record<string, (args: any) => string> = {
  list_primitives() {
    return COMPONENTS.map((c) => {
      const params = Object.entries(c.params)
        .map(([k, p]) => `${k}: ${p.min}-${p.max} (default ${c.defaults[k]})`)
        .join(', ');
      return `${c.id}: ${c.name} — ${c.description} | Params: ${params}`;
    }).join('\n');
  },

  get_current_spec() {
    const s = spec();
    return JSON.stringify({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      parts: s.parts,
      ops: s.ops,
    }, null, 2);
  },

  add_part(args: { prim: string; params: Record<string, number>; id?: string; transform?: any }) {
    const s = spec();
    const def = COMPONENTS.find((c) => c.id === args.prim);
    if (!def) return `Error: unknown primitive "${args.prim}". Call list_primitives to see available types.`;

    const partId = args.id ?? nextPartId();
    if (s.parts.some((p) => p.id === partId)) return `Error: part id "${partId}" already exists.`;

    const mergedParams = { ...def.defaults, ...args.params };

    const part: AuthoredPart = {
      id: partId,
      prim: args.prim,
      params: mergedParams,
      ...(args.transform ? { transform: args.transform } : {}),
    };
    s.parts = [...s.parts, part];
    changed();
    return `Added ${partId}: ${args.prim} (${Object.entries(mergedParams).map(([k, v]) => `${k}=${v}`).join(', ')})${args.transform ? ` transform: ${JSON.stringify(args.transform)}` : ''}`;
  },

  modify_part(args: { target_id: string; params?: Record<string, number>; transform?: any; prim?: string }) {
    const s = spec();
    const idx = s.parts.findIndex((p) => p.id === args.target_id);
    if (idx < 0) return `Error: no part with id "${args.target_id}".`;

    const part = { ...s.parts[idx] };

    if (args.prim && args.prim !== part.prim) {
      const def = COMPONENTS.find((c) => c.id === args.prim);
      if (!def) return `Error: unknown primitive "${args.prim}".`;
      part.prim = args.prim;
      part.params = { ...def.defaults };
    }
    if (args.params) {
      part.params = { ...part.params, ...args.params };
    }
    if (args.transform) {
      part.transform = { ...(part.transform ?? {}), ...args.transform };
    }

    s.parts[idx] = part;
    s.parts = [...s.parts];
    changed();
    return `Modified ${args.target_id}: ${JSON.stringify(part.params)}${part.transform ? ` transform: ${JSON.stringify(part.transform)}` : ''}`;
  },

  remove_part(args: { target_id: string }) {
    const s = spec();
    const before = s.parts.length;
    s.parts = s.parts.filter((p) => p.id !== args.target_id);
    if (s.parts.length === before) return `Error: no part with id "${args.target_id}".`;
    s.ops = s.ops.filter((o) => !o.inputs.includes(args.target_id));
    changed();
    return `Removed ${args.target_id}. ${s.parts.length} parts remaining.`;
  },

  add_op(args: { op: string; inputs: string[]; out?: string }) {
    const s = spec();
    if (!['union', 'subtract', 'intersect'].includes(args.op)) {
      return `Error: op must be "union", "subtract", or "intersect".`;
    }
    if (!args.inputs || args.inputs.length < 2) {
      return `Error: op needs at least 2 inputs.`;
    }
    const allIds = [...s.parts.map((p) => p.id), ...s.ops.map((o) => o.out)];
    const missing = args.inputs.filter((id) => !allIds.includes(id));
    if (missing.length > 0) return `Error: unknown input id(s): ${missing.join(', ')}`;

    const outId = args.out ?? nextOpId();
    if (allIds.includes(outId)) return `Error: id "${outId}" already exists.`;

    const op: AuthoredOp = {
      op: args.op as AuthoredOp['op'],
      inputs: args.inputs,
      out: outId,
    };
    s.ops = [...s.ops, op];
    changed();
    return `Added op ${outId}: ${args.op}(${args.inputs.join(', ')})`;
  },

  remove_op(args: { target_id: string }) {
    const s = spec();
    const before = s.ops.length;
    s.ops = s.ops.filter((o) => o.out !== args.target_id);
    if (s.ops.length === before) return `Error: no op with out id "${args.target_id}".`;
    s.ops = s.ops.filter((o) => !o.inputs.includes(args.target_id));
    changed();
    return `Removed op ${args.target_id}. ${s.ops.length} ops remaining.`;
  },

  set_metadata(args: { name?: string; description?: string; tags?: string[] }) {
    const s = spec();
    if (args.name !== undefined) s.name = args.name;
    if (args.description !== undefined) s.description = args.description;
    if (args.tags !== undefined) s.tags = args.tags;
    changed();
    const fields = Object.keys(args).filter((k) => (args as any)[k] !== undefined);
    return `Updated ${fields.join(', ')}.`;
  },
};

/**
 * Dispatch a tool call from the chat state's tool loop.
 * Returns a result string to feed back to Claude as tool_result content.
 */
export function dispatchToolCall(name: string, args: any): string {
  const impl = TOOL_IMPLS[name];
  if (!impl) return `Error: unknown tool "${name}".`;
  try {
    return impl(args);
  } catch (e: any) {
    return `Error executing ${name}: ${e?.message ?? e}`;
  }
}

/**
 * Read a summary of the current spec for injection into the API call
 * as appState. Lightweight — no base64 thumbnails.
 */
export function readAppState(): string {
  if (!_spec) return '{"error": "no spec bound"}';
  return JSON.stringify({
    name: _spec.name || '(untitled)',
    parts: _spec.parts.map((p) => ({ id: p.id, prim: p.prim, params: p.params, transform: p.transform })),
    ops: _spec.ops,
    parts_count: _spec.parts.length,
    ops_count: _spec.ops.length,
  });
}
