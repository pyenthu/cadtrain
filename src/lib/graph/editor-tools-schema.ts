/**
 * editor-tools-schema.ts — the AI tool REGISTRY for the graph editor's ✨
 * assistant (Phase 1).
 *
 * PURE DATA + lowering functions only. NO Svelte, NO DOM, NO server imports —
 * importable on the server (the /api/rag/assist proxy) AND in the browser (the
 * client tool-loop), AND unit-testable in isolation. Mirrors the SVTC pattern
 * (`~/code/SVTC/src/lib/ai/toolSchema.js`): a `TOOLS` array of plain records +
 * a `toClaudeTools()` that lowers them to the Anthropic Messages-API tool shape
 * `{ name, description, input_schema }`, + a `toolListText()` for prose dumps.
 *
 * Each tool wraps ONE pure mutation/read function from composition-graph.ts.
 * The dispatcher that runs them lives in editor-tools.ts; this file only
 * DESCRIBES them so a model knows what it can call.
 *
 * Phase 1 (safe subset — params · wiring · "add a point"):
 *   getEditorState · addParam · setParamSchema · wireArgToParam ·
 *   setCallArg · addPolygonPoint · setPolygonCoord
 * Phase 2 (structural + transforms): addCall · removeNode · moveNode · rotateNode
 *   · csg(subtract/add/intersect) are here now.
 *
 * The one shape the model MUST learn is the `ArgValue` union — every Call arg
 * and every polygon coordinate is one of:
 *   { "kind": "literal", "value": <number|string|boolean> }   // a fixed value
 *   { "kind": "expr",    "expr":  "<js expression>" }          // e.g. "p.od/2 - p.wall"
 *   { "kind": "param",   "param": "<paramName>" }              // wired to a PARAMS slider
 * As a convenience the dispatcher also accepts a bare number/string/boolean and
 * promotes it to { kind:'literal', value }. The descriptions below teach this.
 */

/** One declared parameter of a tool. `type` maps to JSON-schema. `enum`/`items`
 *  are optional refinements; `required` flags it in the lowered input_schema. */
export type ToolParam = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  desc: string;
  required?: boolean;
  enum?: Array<string | number>;
  /** For `type:'array'` — the schema of each element. */
  items?: Record<string, unknown>;
  /** For `type:'object'` — nested property schemas (teaches the ArgValue union). */
  properties?: Record<string, unknown>;
};

export type ToolDef = {
  name: string;
  desc: string;
  params: Record<string, ToolParam>;
};

/** Reused JSON-schema fragment describing the ArgValue union as a tool param.
 *  Kept verbose on purpose — SVTC's lesson is that the per-param description
 *  string carries the load in getting the model to emit the right shape. */
const ARG_VALUE_PARAM: ToolParam = {
  type: 'object',
  required: true,
  desc:
    'The value to assign, as an ArgValue union object. One of: ' +
    '{"kind":"literal","value":N} for a fixed number/string/boolean; ' +
    '{"kind":"expr","expr":"p.od/2 - p.wall"} for a JS expression evaluated at ' +
    'bake time (assembly params are bound as p.<name>, Math is available); or ' +
    '{"kind":"param","param":"OD"} to wire this slot to the PARAMS row named OD. ' +
    'A bare number/string/boolean is also accepted and treated as a literal.',
  properties: {
    kind: { type: 'string', enum: ['literal', 'expr', 'param'], description: 'Which ArgValue variant.' },
    value: { type: ['number', 'string', 'boolean'], description: 'The constant, when kind=literal.' },
    expr: { type: 'string', description: 'The JS expression, when kind=expr.' },
    param: { type: 'string', description: 'The PARAMS row name, when kind=param.' },
  },
};

/** Schema-shaped params shared by addParam + setParamSchema (a ParamSchema). */
const PARAM_SCHEMA_FIELDS: Record<string, ToolParam> = {
  default: {
    type: 'number',
    required: true,
    desc: 'Default value for the slider/param. Usually a number; strings/booleans allowed.',
  },
  min: { type: 'number', desc: 'Optional slider minimum.' },
  max: { type: 'number', desc: 'Optional slider maximum.' },
  step: { type: 'number', desc: 'Optional slider step.' },
  unit: { type: 'string', desc: 'Optional unit label (e.g. "in", "deg").' },
  label: { type: 'string', desc: 'Optional human-friendly label shown on the card.' },
};

export const EDITOR_TOOLS: ToolDef[] = [
  {
    name: 'getEditorState',
    desc:
      'Read the current state of the part being edited: its PARAMS rows, all ' +
      'graph nodes (id, alias, type, src), the selected node id, and the active ' +
      'tab id. Call this FIRST to orient — node ids look like "n_ab12cd" and you ' +
      'cannot guess them, so list them here before any tool that targets a node. ' +
      'Read-only; it never mutates the graph.',
    params: {},
  },
  {
    name: 'addParam',
    desc:
      'Add a new PARAMS row (an assembly-level parameter slider) so calls and ' +
      'polygon coordinates can wire to it. No-op (idempotent) if a param of the ' +
      'same name already exists.',
    params: {
      name: { type: 'string', required: true, desc: 'Param name — identifier-style, e.g. "OD", "wall".' },
      ...PARAM_SCHEMA_FIELDS,
    },
  },
  {
    name: 'setParamSchema',
    desc:
      'Update an EXISTING PARAMS row\'s schema (default/min/max/step/unit/label) ' +
      'without touching any wires. Errors if the named param does not exist — add ' +
      'it with addParam first.',
    params: {
      name: { type: 'string', required: true, desc: 'Name of the existing param to update.' },
      ...PARAM_SCHEMA_FIELDS,
    },
  },
  {
    name: 'wireArgToParam',
    desc:
      'Wire a Call node\'s argument slot to a PARAMS row — sugar for setting the ' +
      'arg to {kind:"param",param:<paramName>}. The param should already exist ' +
      '(addParam first). Identify the node by its id (n_...) or its alias (A, B, …).',
    params: {
      node: { type: 'string', required: true, desc: 'Target Call node — its id (n_...) or alias.' },
      key: { type: 'string', required: true, desc: "The arg name on the call (the imported fn's param key)." },
      param: { type: 'string', required: true, desc: 'The PARAMS row name to wire into the slot.' },
    },
  },
  {
    name: 'setCallArg',
    desc:
      'Set one argument slot on a Call node to a specific value (literal, expr, ' +
      'or param). Untouched slots are preserved. Identify the node by id or alias.',
    params: {
      node: { type: 'string', required: true, desc: 'Target Call node — its id (n_...) or alias.' },
      key: { type: 'string', required: true, desc: "The arg name on the call (the imported fn's param key)." },
      value: ARG_VALUE_PARAM,
    },
  },
  {
    name: 'addPolygonPoint',
    desc:
      'Insert a new vertex into a polygon node. By default appends at the end; ' +
      'pass afterIdx to insert after that 0-based entry (afterIdx=-1 prepends). ' +
      'The new vertex copies the coords of the row above so you can tweak from a ' +
      'known base. Use setPolygonCoord afterwards to set its (r, z).',
    params: {
      polygon: { type: 'string', required: true, desc: 'Target polygon node — its id (n_...).' },
      afterIdx: {
        type: 'integer',
        desc: 'Optional 0-based index to insert AFTER. Omit to append; -1 to prepend.',
      },
    },
  },
  {
    name: 'setPolygonCoord',
    desc:
      'Set one coordinate (r or z) of one entry in a polygon. Works on a literal ' +
      'vertex (the single r/z pair). The value is an ArgValue (literal/expr/param), ' +
      'so a coordinate can be a constant, a formula, or wired to a PARAMS slider.',
    params: {
      polygon: { type: 'string', required: true, desc: 'Target polygon node — its id (n_...).' },
      idx: { type: 'integer', required: true, desc: '0-based index of the entry to edit.' },
      axis: { type: 'string', required: true, enum: ['r', 'z'], desc: 'Which axis to set: "r" or "z".' },
      value: ARG_VALUE_PARAM,
    },
  },
  // ── Phase 2 (structural) ─────────────────────────────────────────────────
  {
    name: 'addCall',
    desc:
      'Add a Call node that instances another part by its id (`src`) — the way to ' +
      'COMPOSE: e.g. add "g_collar", then position or subtract it. The new node ' +
      'gets an auto alias (A, B, …) and its args default to the part\'s own ' +
      'defaults; set them afterward with setCallArg / wireArgToParam. Returns the ' +
      'new node id. The `src` must be an existing primitive/part id.',
    params: {
      src: { type: 'string', required: true, desc: 'Part id to instance, e.g. "g_collar", "r_revolve", "g_shaft".' },
    },
  },
  {
    name: 'removeNode',
    desc:
      'Delete a node from the graph by id (or a Call alias). References to it are ' +
      'severed (container children, method operands, mv/rot targets). The ROOT ' +
      'node cannot be removed. When the user says "delete this" / "remove this", ' +
      'they mean the SELECTED node — its id is `selectedId` in the editor state.',
    params: {
      node: { type: 'string', required: true, desc: 'Node to delete — its id (n_...) or a Call alias (A, B, …).' },
    },
  },
  {
    name: 'moveNode',
    desc:
      'Wrap a node in a MOVE (mv) transform — offset it by [dx, dy, dz]. ' +
      'Z-DOWN convention: +z moves DOWN-hole (mv [0,0,5] = 5 units toward the ' +
      'bottom; top = LOWER z). Each offset defaults to 0 and may be a number or an ' +
      'expression string (p.<param>). Identify the node by id or alias.',
    params: {
      node: { type: 'string', required: true, desc: 'Node to move — id (n_...) or Call alias.' },
      dx: { type: 'number', desc: 'X offset (default 0).' },
      dy: { type: 'number', desc: 'Y offset (default 0).' },
      dz: { type: 'number', desc: 'Z offset (default 0). +z = DOWN-hole.' },
    },
  },
  {
    name: 'rotateNode',
    desc:
      'Wrap a node in a ROTATE (rot) transform — rotate it by [rx, ry, rz] DEGREES ' +
      'about the X/Y/Z axes. Each angle defaults to 0. Identify the node by id or alias.',
    params: {
      node: { type: 'string', required: true, desc: 'Node to rotate — id (n_...) or Call alias.' },
      rx: { type: 'number', desc: 'Rotation about X in degrees (default 0).' },
      ry: { type: 'number', desc: 'Rotation about Y in degrees (default 0).' },
      rz: { type: 'number', desc: 'Rotation about Z in degrees (default 0).' },
    },
  },
  {
    name: 'csg',
    desc:
      'Combine two nodes with a boolean operation: obj OP arg → a new method node. ' +
      'op "subtract" carves arg out of obj (a bore = body subtract hole); "add" ' +
      'unions them; "intersect" keeps the overlap. Identify obj/arg by id or alias.',
    params: {
      op: { type: 'string', required: true, enum: ['subtract', 'add', 'intersect'], desc: 'The boolean operation.' },
      obj: { type: 'string', required: true, desc: 'The base/left node — id or alias.' },
      arg: { type: 'string', required: true, desc: 'The operand/right node — id or alias.' },
    },
  },
];

/** Lower EDITOR_TOOLS to the Anthropic Messages-API tool format:
 *  `{ name, description, input_schema: { type:'object', properties, required? } }`.
 *  Same shape as SVTC's toClaudeTools(). */
export function toClaudeTools(): Array<{
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}> {
  return EDITOR_TOOLS.map((t) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, p] of Object.entries(t.params)) {
      const prop: Record<string, unknown> = { type: p.type, description: p.desc };
      if (p.enum) prop.enum = p.enum;
      if (p.items) prop.items = p.items;
      if (p.properties) prop.properties = p.properties;
      properties[key] = prop;
      if (p.required) required.push(key);
    }
    return {
      name: t.name,
      description: t.desc,
      input_schema: {
        type: 'object' as const,
        properties,
        ...(required.length ? { required } : {}),
      },
    };
  });
}

/** Plain-text tool list — for system prompts / debugging / a future offline path. */
export function toolListText(): string {
  return EDITOR_TOOLS.map((t) => `- ${t.name}: ${t.desc}`).join('\n');
}
