// src/lib/appkit/manifest/types.ts — the .app document shape (Layer 3).
// A self-contained, declarative manifest: panels + popovers + controls, each bound
// to a verb. See docs/architecture/app-harness.md §4.

/** A verb call: a control's action or a panel's data source. `args` may carry
 *  $active / $item / $params refs (resolved by manifest/refs.ts). */
export interface Binding {
  verb: string;
  args?: Record<string, unknown>;
}

/** Declarative event wiring: event name (click · select · change · …) → an action
 *  (a verb binding) or a SEQUENCE of actions run in order. Wired by the harness. */
export type EventMap = Record<string, Binding | Binding[]>;

export interface Control {
  id?: string;
  /** 'button' | 'table' | 'field' | … (rendered by the panel component). */
  kind: string;
  label?: string;
  /** A param / list<record> name on the bound doc. */
  bind?: string;
  cols?: string[];
  onEdit?: Binding;
  add?: Binding;
  onClick?: Binding;
  /** Declarative events (click · change · …) → action(s). */
  on?: EventMap;
  [k: string]: unknown;
}

export interface Panel {
  id: string;
  /** A PanelKind: list · form · table · bake3d · svg · text · chat · … */
  kind: string;
  title?: string;
  /** The data this panel reads (a data verb; often bound to a file slot). */
  source?: Binding;
  onSelect?: Binding;
  controls?: Control[];
  /** Component props (typed per the component's meta schema). */
  props?: Record<string, unknown>;
  /** Declarative events (click · select · change · …) → action(s). */
  on?: EventMap;
  /** Nested child components — rendered recursively (HTML-style encapsulation). */
  children?: Panel[];
  /** Grid placement (Track A) — column/row start + span. */
  layout?: { col?: number; row?: number; w?: number; h?: number };
  [k: string]: unknown;
}

/** A named data-file the app opens at runtime (§0.5 — the app is stateless; DATA
 *  lives in files). A component's `source` binds to a slot; verbs process that file. */
export interface FileSlot {
  slot: string;
  /** Expected data-file type — '.wson' | '.asm.ts' | … (a hint for the picker). */
  type?: string;
  label?: string;
}

/** A data file opened into a slot at runtime: its name + parsed content. */
export interface SlotValue {
  name: string;
  data: unknown;
  type?: string;
}

/** The runtime slot operations the harness gives the File component (§0.5). */
export interface SlotApi {
  /** Open a data file (File System Access picker) into a slot. */
  openInto(slot: string, type?: string): Promise<void>;
  /** Write the slot's data back to its file (Save As if no handle). */
  save(slot: string): Promise<void>;
  /** Write the slot's data to a new file (picker). */
  saveAs(slot: string): Promise<void>;
}

export interface AppTheme {
  mode?: 'light' | 'dark';
  /** Accent colour (hex or a Tailwind/Flowbite token). */
  accent?: string;
}

export interface AppManifest {
  app: string;
  title?: string;
  docType?: string;
  panels: Panel[];
  popovers?: Panel[];
  /** Data-file slots the app opens (§0.5). */
  files?: FileSlot[];
  /** Declarative computed variables: name → "= formula" over params + earlier vars.
   *  Evaluated reactively (manifest/compute.ts); referenced via $vars.<name>. */
  computed?: Record<string, string>;
  /** Embedded Markdown doc — travels inside the .app; feeds the design-RAG.
   *  Auto-summarized from the structure when empty (manifest/doc.ts). */
  doc?: string;
  /** Theme (Track A). */
  theme?: AppTheme;
  [k: string]: unknown;
}
