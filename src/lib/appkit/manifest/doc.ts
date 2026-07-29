// src/lib/appkit/manifest/doc.ts — generate a Markdown summary of an .app from its
// STRUCTURE (used by the Doc view when the embedded `doc` is empty). The MD is
// human-readable + is the retrieval KEY for the design-RAG (MD ↔ .app pairs). Pure.
import type { AppManifest } from './types';

export function autoDoc(app: AppManifest): string {
  const lines: string[] = [`# ${app.title ?? app.app}`, ''];
  if (app.docType) lines.push(`Type: \`${app.docType}\``, '');

  if (app.files?.length) {
    lines.push('## Data files', '');
    for (const f of app.files) {
      lines.push(`- **${f.label ?? f.slot}** (\`${f.slot}\`${f.type ? `, ${f.type}` : ''})`);
    }
    lines.push('');
  }

  lines.push('## Panels', '');
  for (const p of app.panels ?? []) {
    const src = p.source ? ` — source \`${p.source.verb}\`` : '';
    lines.push(`- **${p.title ?? p.id}** (\`${p.kind}\`)${src}`);
    for (const c of p.controls ?? []) {
      const bind = c.bind ? ` bound to \`${c.bind}\`` : '';
      lines.push(`  - ${c.kind}${bind}`);
    }
  }
  if (!app.panels?.length) lines.push('- _(no panels yet)_');
  lines.push('');
  return lines.join('\n');
}
