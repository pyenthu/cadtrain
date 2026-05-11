/**
 * Level-4 Assembly library — multi-component products / installed strings.
 *
 * Each assembly is an AuthoredComponent spec that composes multiple level-3
 * parts (or directly primitives, for now). Renders via buildAuthored().
 *
 * Real-world assemblies are deep — a completion string can be 50+
 * components stacked over thousands of feet. The entries below are
 * intentionally short (2–4 parts) so the rendered geometry stays legible
 * in the viewer. Once we have a "stack N tubing joints" generator the
 * counts can scale up.
 */

import type { AuthoredComponent } from '$lib/authoring/schema';

export interface AssemblyL4 {
  id: string;
  name: string;
  description: string;
  tags: string[];
  spec: AuthoredComponent;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Stack tubing joints on top of each other vertically. zStart is the
 *  bottom of the bottom-most joint. Each joint adds (bodyLength + 0.6) of
 *  length (body + box-top; pin overlaps the previous joint's box). */
function stackTubing(opts: {
  prefix: string;
  count: number;
  bodyOD: number;
  wall: number;
  bodyLength?: number;
  threadCount?: number;
  zStart?: number;
}) {
  const bodyLength = opts.bodyLength ?? 4.0;
  const threadCount = opts.threadCount ?? 5;
  const parts: any[] = [];
  const stepZ = bodyLength + 0.6;
  for (let i = 0; i < opts.count; i++) {
    const zBase = (opts.zStart ?? 0) + i * stepZ;
    parts.push(
      {
        id: `${opts.prefix}_body_${i}`, kind: 'primitive', prim: 'hollow_cylinder',
        params: { od: opts.bodyOD, wall: opts.wall, length: bodyLength },
        transform: { tz: zBase },
      },
      {
        id: `${opts.prefix}_box_${i}`, kind: 'primitive', prim: 'threaded_box',
        params: {
          od: opts.bodyOD * 1.18, wall: opts.wall + 0.05, length: 0.6,
          threadCount, threadDepth: 0.04, taper: 0.0625,
        },
        transform: { tz: zBase + bodyLength },
      },
      {
        id: `${opts.prefix}_pin_${i}`, kind: 'primitive', prim: 'threaded_pin',
        params: {
          od: opts.bodyOD, wall: opts.wall, length: 0.6,
          threadCount, threadDepth: 0.04, taper: 0.0625,
        },
        transform: { tz: zBase - 0.6 },
      },
    );
  }
  return parts;
}

// ── Catalog ──────────────────────────────────────────────────────────────

export const ASSEMBLIES_L4: AssemblyL4[] = [
  {
    id: 'string_2375_3jt',
    name: '2-3/8" EUE Tubing String (3 joints)',
    description: 'Short production string — three 2-3/8" EUE tubing joints stacked. Smallest viable demo of the stacking model; real strings are 50+ joints.',
    tags: ['production string', 'tubing string', '2-3/8', 'EUE'],
    spec: {
      id: 'string_2375_3jt',
      name: '2-3/8" EUE Tubing String (3 joints)',
      description: '3-joint 2-3/8" EUE tubing string',
      tags: ['production string', 'tubing string', '2-3/8', 'EUE'],
      version: 1,
      created: new Date('2026-05-12').toISOString(),
      source: 'manual',
      parts: stackTubing({ prefix: 't1', count: 3, bodyOD: 2.375, wall: 0.190 }),
      ops: [],
    },
  },
  {
    id: 'string_2875_packer_assembly',
    name: '2-7/8" Tubing + Packer Element',
    description: '2-7/8" EUE tubing joint on top of a packer element. Minimal completion: tubing → packer; in reality there would be a setting tool, slips, and a tail pipe below.',
    tags: ['completion', 'packer', '2-7/8', 'EUE', 'tubing'],
    spec: {
      id: 'string_2875_packer_assembly',
      name: '2-7/8" Tubing + Packer',
      description: 'Tubing joint + packer element assembly',
      tags: ['completion', 'packer', '2-7/8', 'EUE'],
      version: 1,
      created: new Date('2026-05-12').toISOString(),
      source: 'manual',
      parts: [
        // Packer element at bottom (z = 0..2).
        {
          id: 'packer', kind: 'primitive', prim: 'packer_element',
          params: { odCompressed: 2.5, odExpanded: 4.0, mandrelOD: 1.5, length: 2.0, numRings: 3 },
          transform: { tz: 0 },
        },
        // One tubing joint above the packer (z = 2..6).
        ...stackTubing({ prefix: 'jt', count: 1, bodyOD: 2.875, wall: 0.217, zStart: 2 }),
      ],
      ops: [],
    },
  },
  {
    id: 'string_2875_2jt_slips_packer',
    name: '2-7/8" Completion (2 joints + slips + packer)',
    description: 'Slightly fuller completion: two tubing joints + slip assembly + packer. Demonstrates a level-4 assembly drawing on three different primitive types (cylinder, slips, packer).',
    tags: ['completion', 'packer', 'slips', '2-7/8', 'EUE', 'multi-element'],
    spec: {
      id: 'string_2875_2jt_slips_packer',
      name: '2-7/8" Completion (2 jt + slips + packer)',
      description: 'Two joints + slips + packer',
      tags: ['completion', 'packer', 'slips', '2-7/8'],
      version: 1,
      created: new Date('2026-05-12').toISOString(),
      source: 'manual',
      parts: [
        // Packer element at the very bottom.
        {
          id: 'packer', kind: 'primitive', prim: 'packer_element',
          params: { odCompressed: 2.5, odExpanded: 4.0, mandrelOD: 1.5, length: 2.0, numRings: 3 },
          transform: { tz: 0 },
        },
        // Slips just above the packer.
        {
          id: 'slips', kind: 'primitive', prim: 'slips',
          params: { slipOD: 3.0, bodyOD: 2.0, height: 1.5, numSectors: 6, gapWidth: 0.15, numGrooves: 6, grooveDepth: 0.06 },
          transform: { tz: 2 },
        },
        // Two tubing joints stacked on top.
        ...stackTubing({ prefix: 'jt', count: 2, bodyOD: 2.875, wall: 0.217, zStart: 3.5 }),
      ],
      ops: [],
    },
  },

  // ── Catalog-inspired (Halliburton Intelligent Completions Catalog +
  //    Multilateral Technology Catalog) ──
  {
    id: 'smartwell_2zone',
    name: 'SmartWell 2-Zone Intelligent Completion',
    description: 'Simplified Halliburton SmartWell completion: top packer + HS-ICV (upper zone) + isolation packer + HS-ICV (lower zone) + bottom plug. Each ICV provides remote zonal control; packers isolate the two reservoir zones.',
    tags: ['SmartWell', 'intelligent completion', 'multi-zone', 'ICV', 'packer', 'Halliburton'],
    spec: {
      id: 'smartwell_2zone',
      name: 'SmartWell 2-Zone',
      description: 'Two-zone intelligent completion',
      tags: ['SmartWell', 'ICV', 'multi-zone'],
      version: 1,
      created: new Date('2026-05-12').toISOString(),
      source: 'manual',
      parts: [
        { id: 'top_packer', kind: 'primitive', prim: 'packer_element',
          params: { odCompressed: 3.5, odExpanded: 5.5, mandrelOD: 2.6, length: 1.5, numRings: 3 },
          transform: { tz: 8 } },
        { id: 'upper_icv', kind: 'primitive', prim: 'sliding_sleeve',
          params: { od: 3.5, wall: 0.35, length: 3.0, numPorts: 4, portWidth: 0.3, portHeight: 0.8, sealBoreDepth: 0.06, sealBoreHeight: 0.4 },
          transform: { tz: 5 } },
        { id: 'iso_packer', kind: 'primitive', prim: 'packer_element',
          params: { odCompressed: 3.5, odExpanded: 5.5, mandrelOD: 2.6, length: 1.5, numRings: 3 },
          transform: { tz: 3 } },
        { id: 'lower_icv', kind: 'primitive', prim: 'sliding_sleeve',
          params: { od: 3.5, wall: 0.35, length: 3.0, numPorts: 4, portWidth: 0.3, portHeight: 0.8, sealBoreDepth: 0.06, sealBoreHeight: 0.4 },
          transform: { tz: 0 } },
        { id: 'bottom_plug', kind: 'primitive', prim: 'hollow_cylinder',
          params: { od: 3.5, wall: 0.5, length: 0.6 },
          transform: { tz: -0.6 } },
      ],
      ops: [],
    },
  },
  {
    id: 'multilateral_junction',
    name: 'Multilateral Junction (Pre-Milled Window + Whipstock)',
    description: 'Halliburton LatchRite-style multilateral junction: pre-milled window casing joint with whipstock set inside, deflecting the lateral bit. Latch coupling above; tubing string continues up.',
    tags: ['multilateral', 'TAML', 'junction', 'LatchRite', 'whipstock', 'window', 'Halliburton'],
    spec: {
      id: 'multilateral_junction',
      name: 'Multilateral Junction',
      description: 'Pre-milled window + whipstock junction',
      tags: ['multilateral', 'TAML'],
      version: 1,
      created: new Date('2026-05-12').toISOString(),
      source: 'manual',
      parts: [
        { id: 'window_joint', kind: 'primitive', prim: 'window_cutout',
          params: { od: 7.0, wall: 0.4, length: 5.0, windowWidth: 2.0, windowHeight: 3.0, windowOffset: 1.0 },
          transform: { tz: 0 } },
        { id: 'whipstock', kind: 'primitive', prim: 'whipstock',
          params: { od: 5.0, length: 4.0, rampHeight: 2.0, rampOffset: 0 },
          transform: { tz: 0.5 } },
        { id: 'latch_coupling', kind: 'primitive', prim: 'grooved_cylinder',
          params: { od: 8.0, wall: 0.5, length: 1.5, numGrooves: 4, grooveDepth: 0.06 },
          transform: { tz: 5.0 } },
        { id: 'tubing_body', kind: 'primitive', prim: 'hollow_cylinder',
          params: { od: 5.5, wall: 0.35, length: 4.0 },
          transform: { tz: 6.5 } },
      ],
      ops: [],
    },
  },
];
