/**
 * Tool schema for Claude-assisted authoring.
 * Pure data — no Svelte imports, safe to import on the server.
 * Mirrors SVTC's toolSchema.js pattern.
 */

interface ToolParam {
  type: string;
  desc: string;
  required?: boolean;
  enum?: string[];
}

interface ToolDef {
  name: string;
  desc: string;
  params: Record<string, ToolParam>;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_primitives',
    desc: 'List all 18 available primitive types with their parameter definitions and defaults. Call this first to understand what you can build with.',
    params: {},
  },
  {
    name: 'get_current_spec',
    desc: 'Get the current authored component spec: name, parts, ops, and metadata. Returns the full JSON.',
    params: {},
  },
  {
    name: 'add_part',
    desc: 'Add a new primitive part to the component. The part is built from the primitive library and positioned via an optional transform.',
    params: {
      prim: { type: 'string', desc: 'Primitive id from the library (e.g. "hollow_cylinder", "threaded_pin")', required: true },
      params: { type: 'object', desc: 'Parameter values for the primitive (e.g. {"od": 3, "wall": 0.3, "length": 6}). Use defaults from list_primitives if unsure.', required: true },
      id: { type: 'string', desc: 'Optional part id (e.g. "p2"). Auto-assigned if omitted.' },
      transform: { type: 'object', desc: 'Optional transform: {tx, ty, tz, rx, ry, rz}. Z is axial (Z-down). Use tz to stack parts along the axis.' },
    },
  },
  {
    name: 'modify_part',
    desc: 'Modify an existing part\'s params or transform. Only the specified fields are changed; others are preserved.',
    params: {
      target_id: { type: 'string', desc: 'The part id to modify (e.g. "p0")', required: true },
      params: { type: 'object', desc: 'Partial params to merge (e.g. {"od": 4} to change only OD)' },
      transform: { type: 'object', desc: 'Partial transform to merge (e.g. {"tz": 5} to reposition)' },
      prim: { type: 'string', desc: 'Change the primitive type (resets params to new primitive defaults)' },
    },
  },
  {
    name: 'remove_part',
    desc: 'Remove a part by id. Also removes any ops that reference this part.',
    params: {
      target_id: { type: 'string', desc: 'The part id to remove', required: true },
    },
  },
  {
    name: 'add_op',
    desc: 'Add a CSG operation that combines parts or prior op outputs. The first input is the base; subsequent inputs are applied in order.',
    params: {
      op: { type: 'string', desc: 'CSG operation type', required: true, enum: ['union', 'subtract', 'intersect'] },
      inputs: { type: 'array', desc: 'Array of part ids or prior op out-ids to combine (minimum 2)', required: true },
      out: { type: 'string', desc: 'Output id for this op result (e.g. "op0"). Auto-assigned if omitted.' },
    },
  },
  {
    name: 'remove_op',
    desc: 'Remove a CSG operation by its output id. Also removes ops that depend on this one.',
    params: {
      target_id: { type: 'string', desc: 'The op output id to remove', required: true },
    },
  },
  {
    name: 'set_metadata',
    desc: 'Set the component name, description, or tags.',
    params: {
      name: { type: 'string', desc: 'Component name' },
      description: { type: 'string', desc: 'Component description' },
      tags: { type: 'array', desc: 'Array of tag strings' },
    },
  },
];

/**
 * Convert to Anthropic API tool-use format.
 */
export function toClaudeTools() {
  return TOOLS.map((t) => {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, p] of Object.entries(t.params)) {
      const prop: any = { description: p.desc };
      if (p.type === 'array') {
        prop.type = 'array';
        prop.items = { type: 'string' };
      } else if (p.type === 'object') {
        prop.type = 'object';
      } else {
        prop.type = p.type;
      }
      if (p.enum) prop.enum = p.enum;
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
