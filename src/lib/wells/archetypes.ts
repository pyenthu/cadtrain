/**
 * Well-archetype registry — typed snapshot of SVTC's `archetypes.json`
 * (`~/code/SVTC/.dev-volume/samples/schematics/archetypes.json`, its own
 * `_comment` labels it "TODO #20 Layer A"). It is a natural-language → WSON
 * registry: a `createFromArchetype`-style resolver looks a request up by slug
 * OR any alias (case-insensitive substring match), loads the `template` .wson,
 * and applies user overrides.
 *
 * This is a STANDALONE DATA MODULE — it imports nothing from the wells engine
 * and (as of the #42i snapshot) has no consumer yet; it is the deterministic
 * seed for #42d (WBG Wizard / Auto Design) and the local-first AI work (#0), so
 * those can build "make me a horizontal shale producer" without an LLM inventing
 * geometry. Provenance + the full corpus summary: `docs/plans/wells-sample-corpus.md`.
 *
 * SNAPSHOT — captured 2026-07-11. If the upstream `archetypes.json` changes,
 * re-derive this file rather than editing values by hand. `template` names the
 * sibling `.wson`; not every template exists under `src/lib/wells/samples/` yet,
 * so treat it as a reference label until #42d wires template resolution.
 */

export interface ArchetypeDefaults {
	/** Total depth (m) — an override here scales all template depths. */
	td: number;
	trajectory: 'vertical' | 'horizontal';
	/** Reservoir top depth (m). */
	reservoirTop: number;
}

export interface WellArchetype {
	/** Stable id. */
	slug: string;
	title: string;
	/** Sibling `.wson` template filename in the canonical corpus. */
	template: string;
	/** Natural-language handles; matched case-insensitively as substrings. */
	aliases: readonly string[];
	defaults: ArchetypeDefaults;
}

export const WELL_ARCHETYPES: readonly WellArchetype[] = [
	{
		slug: 'vertical-land-producer',
		title: 'Vertical Land Producer',
		template: '01-vertical-land-producer.wson',
		aliases: [
			'vertical producer', 'land producer', 'vertical land producer', 'standard producer',
			'simple producer', 'onshore producer', 'producer', 'basic producer', '3-string producer',
			'oil producer', 'oil producing well', 'oil well', 'oil producing', 'producing well',
			'production well', 'typical well', 'example well', 'sample well',
		],
		defaults: { td: 1070, trajectory: 'vertical', reservoirTop: 1040 },
	},
	{
		slug: 'waterflood-injector',
		title: 'Waterflood Injector',
		template: '02-waterflood-injector.wson',
		aliases: [
			'water injector', 'waterflood injector', 'standard water injector', 'wag injector',
			'injector', 'injection well', 'water injection well', 'waterflood well', 'injector well',
		],
		defaults: { td: 1200, trajectory: 'vertical', reservoirTop: 1170 },
	},
	{
		slug: 'offshore-dev-producer-scssv-gaslift',
		title: 'Offshore Development Producer with SCSSV + Gas Lift',
		template: '03-offshore-dev-scssv-gaslift.wson',
		aliases: [
			'offshore producer', 'offshore development well', 'offshore dev well', 'scssv producer',
			'gas lift producer', 'gas-lift producer', 'offshore completion', 'offshore gaslift',
			'development producer', 'offshore gas lift', 'offshore gas-lift well',
			'offshore with gas lift', 'offshore producer with gas lift',
		],
		defaults: { td: 2500, trajectory: 'vertical', reservoirTop: 2430 },
	},
	{
		slug: 'horizontal-shale-plug-and-perf',
		title: 'Horizontal Shale Producer (Plug-and-Perf)',
		template: '04-horizontal-shale-pnp.wson',
		aliases: [
			'horizontal producer', 'shale producer', 'plug and perf', 'plug-and-perf', 'bakken well',
			'eagle ford well', 'unconventional well', 'horizontal well', 'lateral producer',
			'fractured producer',
		],
		defaults: { td: 3500, trajectory: 'horizontal', reservoirTop: 2050 },
	},
	{
		slug: 'esp-producer',
		title: 'ESP-equipped Producer',
		template: '05-esp-producer.wson',
		aliases: [
			'esp', 'esp producer', 'esp well', 'electric submersible pump',
			'submersible pump producer', 'pumped producer', 'artificial lift producer',
			'esp-lifted well',
		],
		defaults: { td: 1800, trajectory: 'vertical', reservoirTop: 1750 },
	},
	{
		slug: 'gas-lift-unloaded-producer',
		title: 'Gas-Lift Unloaded Producer',
		template: '06-gas-lift-unloaded-producer.wson',
		aliases: [
			'gas lift well', 'gas-lift well', 'gas lift unloaded', 'continuous gas lift',
			'gas-lift producer', 'artificial lift gas', 'onshore gas-lift',
		],
		defaults: { td: 2000, trajectory: 'vertical', reservoirTop: 1950 },
	},
	{
		slug: 'deepwater-subsea-dual-barrier',
		title: 'Deepwater Subsea Dual-Barrier Completion',
		template: '07-deepwater-subsea-dual-barrier.wson',
		aliases: [
			'deepwater well', 'subsea completion', 'dual barrier', 'dual-barrier', 'ultra-deep',
			'gulf of mexico completion', 'subsea tree well', 'deepwater subsea',
		],
		defaults: { td: 3500, trajectory: 'vertical', reservoirTop: 3300 },
	},
	{
		slug: 'horizontal-multistage-frac-appraisal',
		title: 'Horizontal Multi-Stage Frac Appraisal Well (7-string)',
		template: '08-hrdh-797-horizontal-multistage-frac.wson',
		aliases: [
			'multistage frac', 'multi-stage frac', 'multi stage frac', 'frac appraisal well',
			'horizontal frac well', 'plug and perf appraisal', 'aramco horizontal', 'unayzah well',
			'hrdh well', '7-string horizontal', 'deep horizontal frac', 'horizontal appraisal well',
			'stage cement dv tool', 'versaflex liner',
		],
		defaults: { td: 5731.2, trajectory: 'horizontal', reservoirTop: 4736.6 },
	},
	{
		slug: 'hpht-completion',
		title: 'HPHT Gas-Condensate Producer',
		template: '09-hpht-completion.wson',
		aliases: [
			'hpht', 'high pressure high temperature', 'hpht well', 'gas condensate producer',
			'elgin style', 'shearwater style', 'britannia style', 'sour service', '13cr completion',
			'deep gas producer', 'hpht completion',
		],
		defaults: { td: 4500, trajectory: 'vertical', reservoirTop: 4450 },
	},
	{
		slug: 'co2-injector',
		title: 'CO2 Injector (CCS)',
		template: '10-co2-injector.wson',
		aliases: [
			'co2 injector', 'co2 injection', 'carbon capture', 'ccs injector', 'carbon storage',
			'supercritical co2', 'sequestration well', 'ccs well', 'co2 disposal',
			'carbon sequestration',
		],
		defaults: { td: 2200, trajectory: 'vertical', reservoirTop: 2150 },
	},
];

/** Fast slug → archetype lookup. */
export const ARCHETYPES_BY_SLUG: ReadonlyMap<string, WellArchetype> = new Map(
	WELL_ARCHETYPES.map((a) => [a.slug, a]),
);

/**
 * Resolve a natural-language request to an archetype, mirroring SVTC's
 * `createFromArchetype` lookup: exact-slug first, then case-insensitive
 * substring match on slug or any alias (the query may CONTAIN an alias, e.g.
 * "make me a horizontal shale producer" matches "shale producer").
 *
 * When several handles match, the **most specific (longest) one wins** — the
 * corpus deliberately overlaps aliases as substrings (bare "producer" on
 * archetype 01 is a catch-all that "shale producer" on 04 must override), so a
 * plain first-match would collapse every "… producer" onto the vertical land
 * producer. Ties break by array order. Returns `undefined` if nothing matches.
 */
export function findArchetype(query: string): WellArchetype | undefined {
	const q = query.trim().toLowerCase();
	if (!q) return undefined;
	// Exact slug wins outright.
	const exact = ARCHETYPES_BY_SLUG.get(q);
	if (exact) return exact;
	let best: WellArchetype | undefined;
	let bestLen = 0;
	for (const a of WELL_ARCHETYPES) {
		for (const handle of [a.slug, ...a.aliases]) {
			const h = handle.toLowerCase();
			if (h.length > bestLen && q.includes(h)) {
				best = a;
				bestLen = h.length;
			}
		}
	}
	return best;
}
