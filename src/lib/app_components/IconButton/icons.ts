// app_components/IconButton/icons.ts — the v1 built-in icon set (named glyphs). Pure data,
// shared by the render + the editor's icon-search. A SERVER icon library (Lucide/Heroicons/…
// served + searched from the backend) is the follow-up — the render already accepts any glyph,
// so swapping the source is additive. See docs/plans/app-studio-enhancements.md (Icon backend).
export const ICONS: Record<string, string> = {
  add: '➕', save: '💾', delete: '🗑️', edit: '✏️', search: '🔍', menu: '☰',
  home: '🏠', settings: '⚙️', download: '⤓', upload: '⤒', check: '✔️', close: '✕',
  star: '★', file: '📄', folder: '📁', play: '▶️', pause: '⏸️', refresh: '↻',
  info: 'ℹ️', warning: '⚠️', user: '👤', users: '👥', mail: '✉️', calendar: '📅',
  chart: '📊', table: '▦', lock: '🔒', unlock: '🔓', bell: '🔔', copy: '⧉',
  link: '🔗', filter: '⌄', sort: '↕', plus: '＋', minus: '－', back: '←',
  forward: '→', up: '↑', down: '↓', print: '🖨️', trash: '🗑️', pin: '📌',
  flag: '🚩', eye: '👁', cog: '⚙', bolt: '⚡', cloud: '☁️', globe: '🌐',
};

export const ICON_NAMES = Object.keys(ICONS);

/** The glyph for a name; unknown names pass through (so any typed emoji works). */
export function iconGlyph(name?: string): string {
  return name ? (ICONS[name] ?? name) : '';
}
