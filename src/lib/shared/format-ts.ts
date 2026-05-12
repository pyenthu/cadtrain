/**
 * Lazy Prettier loader for the runes source editor.
 *
 * Prettier + its TS + estree plugins sum to ~300KB gzipped — heavy
 * enough that we don't want it in the initial /primitives bundle.
 * Loaded on first format call (typically the first Save-to-disk) and
 * cached for the rest of the session.
 *
 * Failure behavior: callers receive the original source unchanged
 * if loading or formatting throws. Format is a nice-to-have, not a
 * correctness gate — a broken Prettier shouldn't block a save.
 */

type PrettierBundle = {
  format: (src: string, opts: Record<string, unknown>) => Promise<string>;
  plugins: unknown[];
};

let bundle: Promise<PrettierBundle> | null = null;

function loadPrettier(): Promise<PrettierBundle> {
  if (!bundle) {
    bundle = (async () => {
      const [prettier, tsPlugin, estreePlugin] = await Promise.all([
        import('prettier/standalone'),
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree'),
      ]);
      return {
        format: prettier.format as PrettierBundle['format'],
        plugins: [tsPlugin.default ?? tsPlugin, estreePlugin.default ?? estreePlugin],
      };
    })();
  }
  return bundle;
}

const OPTIONS = {
  parser: 'typescript',
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  printWidth: 100,
  trailingComma: 'all',
  arrowParens: 'always',
} as const;

export async function formatTypescript(source: string): Promise<string> {
  try {
    const { format, plugins } = await loadPrettier();
    return await format(source, { ...OPTIONS, plugins });
  } catch (err) {
    console.warn('[format-ts] formatting failed, returning original source:', err);
    return source;
  }
}
