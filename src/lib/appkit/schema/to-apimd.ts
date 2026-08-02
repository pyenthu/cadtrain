// src/lib/appkit/schema/to-apimd.ts — generate the API.md authoring guide from the
// registry. This is the ONLY doc the runtime AI sees about the verbs (D6) — small,
// closed, cadtrain-specific. Regenerated whenever a verb changes, so it never drifts.
import { type Verb, type VerbGroup, verbExample } from '../verbs/registry';

const GROUPS: VerbGroup[] = ['data', 'mutate', 'gui'];

export function toApiMd(verbs: Verb[]): string {
  let md = '# App verbs — authoring guide (generated)\n\n';
  for (const g of GROUPS) {
    const vs = verbs.filter((v) => v.group === g);
    if (!vs.length) continue;
    md += `## ${g}\n\n`;
    for (const v of vs) {
      const keys = Object.keys(v.params.properties ?? {});
      md += `- \`${v.name}(${keys.join(', ')})\` — ${v.desc}\n`;
      const ex = verbExample(v);
      if (ex) md += `  - e.g. \`${ex}\`\n`;
    }
    md += '\n';
  }
  return md;
}
