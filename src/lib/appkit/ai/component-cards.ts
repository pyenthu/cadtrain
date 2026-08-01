// src/lib/appkit/ai/component-cards.ts — the builder's COMPONENT KNOWLEDGE, generated from the
// catalog metas (SSOT). #37: the system prompt no longer hand-duplicates per-component prop
// rules (kills drift — add a prop in meta.ts and the builder knows it), AND it spends tokens
// only on the RELEVANT components per prompt (a cheap all-kinds INDEX + full cards for the few
// kinds this prompt actually needs) instead of the full rulebook every call.
import { COMPONENT_CATALOG, type ComponentMeta } from '../catalog/components';

/** "text:string=Text, size:select(xs|sm|md|lg|xl|2xl)=md, color:color, muted:boolean" */
function propSummary(meta: ComponentMeta): string {
  return (meta.props ?? [])
    .map((p) => {
      const t = p.type === 'select' && p.options?.length ? `select(${p.options.join('|')})` : p.type;
      const dflt = p.default !== undefined && p.default !== '' ? `=${p.default}` : '';
      return `${p.name}:${t}${dflt}`;
    })
    .join(', ');
}

/** A FULL rule-card for one kind — the DICTIONARY entry the (esp. local) model relies on:
 *  "- gantt (display) — <what it is / when to use> · props: rowsVar:string, … · e.g. {…verb call…}".
 *  Pulls the description + optional useWhen + a concrete example straight from meta.ts (SSOT), so a
 *  weak local model gets what/when/how per component (not just prop names). */
export function componentCard(meta: ComponentMeta): string {
  const head = `${meta.kind} (${meta.group})${meta.acceptsChildren ? ' · HOLDS children' : ''}`;
  const desc = [meta.description, meta.useWhen].filter(Boolean).join(' ').trim();
  const ps = propSummary(meta);
  const ex = meta.example;
  const parts = [`- ${head}`];
  if (desc) parts.push(`  ${desc}`);
  parts.push(`  props: ${ps || '(none)'}`);
  if (ex) parts.push(`  e.g. ${JSON.stringify(ex)}`);
  return parts.join('\n');
}

/** The compact INDEX — every kind by group on a few lines (the cheap menu the model picks from). */
export function componentIndex(metas: ComponentMeta[] = COMPONENT_CATALOG): string {
  const byGroup: Record<string, string[]> = {};
  for (const m of metas) (byGroup[m.group] ??= []).push(m.kind);
  return Object.entries(byGroup)
    .map(([g, kinds]) => `${g}: ${kinds.join(', ')}`)
    .join(' · ');
}

const CORE_KINDS = ['text', 'heading', 'container', 'div', 'row', 'col', 'card', 'table', 'button'];

/** All kinds present in a panel tree (recursive over children). */
export function collectKinds(panels: Array<{ kind?: string; children?: unknown[] }> = []): string[] {
  const out: string[] = [];
  const walk = (list: Array<{ kind?: string; children?: unknown[] }> = []) => {
    for (const p of list) {
      if (p.kind) out.push(p.kind);
      if (Array.isArray(p.children)) walk(p.children as typeof list);
    }
  };
  walk(panels);
  return out;
}

/** Which kinds to expand into FULL cards for THIS prompt: the core building blocks + kinds
 *  already in the app + kinds whose kind/name/tags tokens appear in the prompt. Keeps it small. */
export function relevantKinds(prompt: string, appKinds: string[] = [], metas: ComponentMeta[] = COMPONENT_CATALOG): Set<string> {
  const known = new Set(metas.map((m) => m.kind));
  const q = new Set(prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const picked = new Set<string>([...CORE_KINDS, ...appKinds].filter((k) => known.has(k)));
  for (const m of metas) {
    const toks = [m.kind, m.name, ...(m.tags ?? [])].join(' ').toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (toks.some((t) => q.has(t))) picked.add(m.kind);
  }
  return picked;
}

/** The COMPONENT KNOWLEDGE block for the system prompt: the full index (all kinds, cheap) +
 *  detailed cards for the relevant kinds only. Replaces the hand-written per-component rules. */
export function renderComponentKnowledge(prompt: string, appKinds: string[] = [], metas: ComponentMeta[] = COMPONENT_CATALOG): string {
  const rel = relevantKinds(prompt, appKinds, metas);
  const cards = metas.filter((m) => rel.has(m.kind)).map(componentCard);
  return [
    `Component kinds — ${componentIndex(metas)}.`,
    'Details for the kinds relevant here (set any prop with setComponentProp; a kind that HOLDS children nests panels via children[]):',
    ...cards,
  ].join('\n');
}
