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
  /** A PanelKind: list · form · table · bake3d · svg · text · chat. */
  kind: string;
  title?: string;
  /** The data this panel reads (a data verb). */
  source?: Binding;
  onSelect?: Binding;
  controls?: Control[];
  [k: string]: unknown;
}

export interface AppManifest {
  app: string;
  title?: string;
  docType?: string;
  panels: Panel[];
  popovers?: Panel[];
  [k: string]: unknown;
}
