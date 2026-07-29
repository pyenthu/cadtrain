// src/lib/appkit/manifest/types.ts — the .app document shape (Layer 3).
// A self-contained, declarative manifest: panels + popovers + controls, each bound
// to a verb. See docs/architecture/app-harness.md §4.

/** A verb call: a control's action or a panel's data source. `args` may carry
 *  $active / $item / $params refs (resolved by manifest/refs.ts). */
export interface Binding {
  verb: string;
  args?: Record<string, unknown>;
}

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
  /** Embedded Markdown doc — travels inside the .app; feeds the design-RAG.
   *  Auto-summarized from the structure when empty (manifest/doc.ts). */
  doc?: string;
  /** Theme (Track A). */
  theme?: AppTheme;
  [k: string]: unknown;
}
