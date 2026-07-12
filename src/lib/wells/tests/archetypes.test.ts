import { describe, it, expect } from 'vitest';
import {
	WELL_ARCHETYPES,
	ARCHETYPES_BY_SLUG,
	findArchetype,
	type WellArchetype,
} from '../archetypes';

describe('WELL_ARCHETYPES shape', () => {
	it('has the 10 canonical archetypes', () => {
		expect(WELL_ARCHETYPES).toHaveLength(10);
	});

	it('every entry is well-formed', () => {
		for (const a of WELL_ARCHETYPES) {
			expect(a.slug, 'slug non-empty').toBeTruthy();
			expect(a.title, 'title non-empty').toBeTruthy();
			expect(a.template, `template for ${a.slug}`).toMatch(/^\d{2}-.*\.wson$/);
			expect(a.aliases.length, `${a.slug} aliases`).toBeGreaterThan(0);
			expect(a.defaults.td, `${a.slug} td`).toBeGreaterThan(0);
			expect(['vertical', 'horizontal']).toContain(a.defaults.trajectory);
			expect(a.defaults.reservoirTop, `${a.slug} reservoirTop`).toBeGreaterThan(0);
			// Reservoir top is above TD for these completions.
			expect(a.defaults.reservoirTop).toBeLessThanOrEqual(a.defaults.td);
		}
	});

	it('slugs are unique', () => {
		const slugs = WELL_ARCHETYPES.map((a) => a.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('templates are unique and numbered 01..10 in order', () => {
		const templates = WELL_ARCHETYPES.map((a) => a.template);
		expect(new Set(templates).size).toBe(templates.length);
		templates.forEach((t, i) => {
			const n = String(i + 1).padStart(2, '0');
			expect(t.startsWith(`${n}-`), `entry ${i} template ${t} starts with ${n}-`).toBe(true);
		});
	});

	// The canonical SVTC corpus has exactly ONE cross-archetype alias collision:
	// "gas-lift producer" is listed under both 03 (offshore-…-gaslift) and 06
	// (gas-lift-unloaded-producer). This test pins that so a NEW accidental
	// collision fails loudly while the known-and-faithful one is documented.
	it('the only cross-archetype alias collision is the known "gas-lift producer"', () => {
		const owners = new Map<string, string[]>();
		for (const a of WELL_ARCHETYPES) {
			for (const alias of a.aliases) {
				const key = alias.toLowerCase();
				const list = owners.get(key) ?? [];
				list.push(a.slug);
				owners.set(key, list);
			}
		}
		const shared = [...owners.entries()].filter(([, s]) => s.length > 1).map(([k]) => k).sort();
		expect(shared).toEqual(['gas-lift producer']);
	});
});

/** Aliases the canonical corpus deliberately shares — see the collision test above. */
const AMBIGUOUS_ALIASES = new Set(['gas-lift producer']);

describe('ARCHETYPES_BY_SLUG', () => {
	it('indexes every archetype by slug', () => {
		expect(ARCHETYPES_BY_SLUG.size).toBe(WELL_ARCHETYPES.length);
		for (const a of WELL_ARCHETYPES) {
			expect(ARCHETYPES_BY_SLUG.get(a.slug)).toBe(a);
		}
	});
});

describe('findArchetype', () => {
	it('resolves an exact slug', () => {
		const a = findArchetype('horizontal-shale-plug-and-perf');
		expect(a?.slug).toBe('horizontal-shale-plug-and-perf');
	});

	it('is case-insensitive on the slug', () => {
		expect(findArchetype('CO2-INJECTOR')?.slug).toBe('co2-injector');
	});

	it('matches an alias embedded in a natural-language request', () => {
		const a = findArchetype('please make me a horizontal shale producer at 3200 m');
		expect(a?.slug).toBe('horizontal-shale-plug-and-perf');
	});

	it('matches a single-word alias', () => {
		expect(findArchetype('esp')?.slug).toBe('esp-producer');
		expect(findArchetype('hpht')?.slug).toBe('hpht-completion');
	});

	it('returns undefined for an empty or unknown query', () => {
		expect(findArchetype('')).toBeUndefined();
		expect(findArchetype('   ')).toBeUndefined();
		expect(findArchetype('geothermal doublet')).toBeUndefined();
	});

	it('every unambiguous alias resolves back to its own archetype', () => {
		for (const a of WELL_ARCHETYPES) {
			for (const alias of a.aliases) {
				if (AMBIGUOUS_ALIASES.has(alias.toLowerCase())) continue;
				const hit: WellArchetype | undefined = findArchetype(alias);
				expect(hit?.slug, `alias "${alias}"`).toBe(a.slug);
			}
		}
	});

	it('an ambiguous alias still resolves to one of its owners', () => {
		// "gas-lift producer" is claimed by both 03 and 06; longest-match ties
		// break by array order → the earlier (offshore) archetype.
		const hit = findArchetype('gas-lift producer');
		expect(['offshore-dev-producer-scssv-gaslift', 'gas-lift-unloaded-producer'])
			.toContain(hit?.slug);
	});
});
