/**
 * extract_figures.ts — picture-first PDF figure extractor.
 *
 * Renders each page of the figure-rich kb-source PDFs to a numbered PNG
 * so the user can curate ("extract 7") BEFORE any primitive-generation
 * spend. Embedded images in these PDFs are fragmented (one figure = many
 * JPEG pieces + vector overlays), so the reliable unit is a rendered
 * PAGE, not a `pdfimages` extraction. One `extract-N` == one page.
 *
 * Output lives on the persistent VOLUME (not static/, not git) under
 * `<volume>/figures/`:
 *   extract-N.png        full-res page render (150 dpi)
 *   extract-N.thumb.png  ~240px-wide thumbnail
 *   gallery.json         { generated_at, items: [{ n, id, pdf, page, file, thumb }] }
 *
 * `file` / `thumb` are volume-relative paths; the browser fetches them
 * via /api/volume?path=... and bun scripts via volumePath().
 *
 * Usage:
 *   bun run scripts/extract_figures.ts                 # default: 100-cap across both PDFs
 *   bun run scripts/extract_figures.ts --max 40        # cap total figures
 *   bun run scripts/extract_figures.ts --pdf api-drill-pipe-specs.pdf
 *   bun run scripts/extract_figures.ts --dpi 200
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { volumePath } from './_volume';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const KB_DIR = join(ROOT, 'kb-sources');
// Output on the volume, not static/ — figures are regenerable data, not
// source. Local dev: <repo>/figures/. Railway: /app_data/figures/.
const FIGURES_REL = 'figures';
const OUT_DIR = volumePath(FIGURES_REL);

// Figure-rich PDFs only — the casing-tubing data PDFs are spec tables,
// not figures, and are deliberately excluded.
const DEFAULT_PDFS = ['api-drill-pipe-specs.pdf', 'bha-reference.pdf'];

interface Args {
  max: number;
  dpi: number;
  pdfs: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let max = 100;
  let dpi = 150;
  const pdfs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max') max = Number(argv[++i]);
    else if (a === '--dpi') dpi = Number(argv[++i]);
    else if (a === '--pdf') pdfs.push(argv[++i]);
  }
  return { max, dpi, pdfs: pdfs.length ? pdfs : DEFAULT_PDFS };
}

/** Page count of a PDF via poppler's pdfinfo. */
async function pdfPageCount(pdfPath: string): Promise<number> {
  return new Promise((res) => {
    let out = '';
    const proc = spawn('pdfinfo', [pdfPath], { timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
    proc.stdout.on('data', (d) => (out += d));
    proc.on('exit', () => {
      const m = /^Pages:\s+(\d+)/m.exec(out);
      res(m ? Number(m[1]) : 0);
    });
    proc.on('error', () => res(0));
  });
}

/** Render one PDF page to a PNG via pdftoppm. Returns true on success. */
async function renderPage(pdfPath: string, page: number, outPath: string, dpi: number): Promise<boolean> {
  const outPrefix = outPath.replace(/\.png$/, '');
  return new Promise((res) => {
    // -singlefile drops the page-number suffix → exactly <outPrefix>.png
    const proc = spawn('pdftoppm', [
      '-png', '-f', String(page), '-l', String(page),
      '-r', String(dpi), '-singlefile', pdfPath, outPrefix,
    ], { timeout: 60_000, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.on('exit', (c) => res(c === 0 && existsSync(outPath)));
    proc.on('error', () => res(false));
  });
}

interface GalleryItem {
  n: number;
  id: string;
  pdf: string;
  page: number;
  file: string;   // volume-relative: figures/extract-N.png
  thumb: string;  // volume-relative: figures/extract-N.thumb.png
}

async function main() {
  const { max, dpi, pdfs } = parseArgs();
  console.log(`[extract_figures] pdfs=${pdfs.join(', ')} max=${max} dpi=${dpi}`);
  console.log(`[extract_figures] output → ${OUT_DIR}`);

  // Fresh output dir each run — numbering is regenerated from scratch.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const items: GalleryItem[] = [];
  let n = 0;

  for (const pdf of pdfs) {
    if (items.length >= max) break;
    const pdfPath = join(KB_DIR, pdf);
    if (!existsSync(pdfPath)) {
      console.warn(`[extract_figures] SKIP missing: ${pdfPath}`);
      continue;
    }
    const pages = await pdfPageCount(pdfPath);
    if (pages === 0) {
      console.warn(`[extract_figures] SKIP unreadable: ${pdf}`);
      continue;
    }
    console.log(`[extract_figures] ${pdf}: ${pages} pages`);

    for (let page = 1; page <= pages; page++) {
      if (items.length >= max) {
        console.log(`[extract_figures] hit --max ${max}, stopping`);
        break;
      }
      n++;
      const id = `extract-${n}`;
      const fileRel = `${FIGURES_REL}/${id}.png`;
      const thumbRel = `${FIGURES_REL}/${id}.thumb.png`;
      const fullPath = join(OUT_DIR, `${id}.png`);
      const thumbPath = join(OUT_DIR, `${id}.thumb.png`);

      const ok = await renderPage(pdfPath, page, fullPath, dpi);
      if (!ok) {
        console.warn(`  ${id}: render FAILED (${pdf} p.${page})`);
        n--; // don't burn a number on a failed render
        continue;
      }
      // Thumbnail: ~240px wide, keeps aspect ratio.
      await sharp(fullPath).resize({ width: 240, withoutEnlargement: true }).png().toFile(thumbPath);

      items.push({ n, id, pdf, page, file: fileRel, thumb: thumbRel });
      if (n % 10 === 0) console.log(`  …${n} figures`);
    }
  }

  const gallery = { generated_at: new Date().toISOString(), items };
  await writeFile(join(OUT_DIR, 'gallery.json'), JSON.stringify(gallery, null, 2));
  console.log(`[extract_figures] done — ${items.length} figures → ${join(OUT_DIR, 'gallery.json')}`);
}

main().catch((e) => {
  console.error('[extract_figures] FATAL', e);
  process.exit(1);
});
