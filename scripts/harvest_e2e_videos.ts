/**
 * harvest_e2e_videos.ts
 *
 * Wraps `bun run test:e2e` and copies the resulting Playwright videos
 * to a stable, plan-task-keyed location on the persistent VOLUME under
 * <volume>/test-recordings/e2e/<task>/ (not static/, not git).
 * Implements the harvest half of CLAUDE.md Rule 12.
 *
 * Usage:
 *   bun run scripts/harvest_e2e_videos.ts --task 116
 *   bun run scripts/harvest_e2e_videos.ts --task 116 --no-run    # use last run's output
 *   bun run scripts/harvest_e2e_videos.ts --task 116 --spec routes  # only routes.spec.ts videos
 *
 * Output (one WEBM per spec file under playwright-output):
 *   <volume>/test-recordings/e2e/<task>/routes.webm
 *   <volume>/test-recordings/e2e/<task>/navbar.webm
 *   <volume>/test-recordings/e2e/<task>/archive-links.webm
 *   <volume>/test-recordings/e2e/<task>/manifest.json   { task, run_at, files: [...] }
 *
 * The manifest is what the /plan Gantt popup reads (via the `video`
 * field in details.ts). One canonical WEBM per spec keeps the popup
 * UI simple — for a per-test breakdown, open the Playwright HTML
 * report at tests/results/playwright-report/.
 *
 * Notes
 *   - Playwright config (playwright.config.ts) sets video: 'on' for
 *     headless runs, so every test produces a video.
 *   - Output directory layout from Playwright is one folder per test
 *     name, each containing video.webm + trace.zip. We pick the
 *     LARGEST video.webm per spec file as the canonical recording
 *     (it covers the most ground).
 *   - The script is idempotent: re-running for the same task
 *     overwrites the previous WEBMs.
 */

import { readdir, copyFile, mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { volumePath } from './_volume';

const PWO_DIR = 'tests/results/playwright-output';
// Recordings live on the volume — regenerable data, not source/git.
const OUT_ROOT = volumePath('test-recordings/e2e');

interface VideoFile {
  spec: string;        // e.g., 'routes', 'navbar', 'archive-links', 'backend'
  testName: string;    // playwright dir name
  size: number;
  src: string;         // absolute path to the source WEBM
}

async function runE2E(): Promise<number> {
  console.log('▶  bun run test:e2e\n');
  const proc = spawn('bun', ['run', 'test:e2e'], {
    stdio: 'inherit',
    env: { ...process.env, PWVIDEO: '1' },
  });
  return new Promise((resolve) => {
    proc.on('exit', (code) => resolve(code ?? -1));
  });
}

// Known spec base names (matches tests/e2e/*.spec.ts file basenames).
// Update when adding new spec files.
const KNOWN_SPECS = ['routes', 'navbar', 'archive-links', 'backend'] as const;

/**
 * Playwright dumps each test into its own dir like:
 *   tests/results/playwright-output/routes-archived-route-loads-archive-c-XXXXX-chromium/video.webm
 *
 * We classify each dir by matching its leading prefix against KNOWN_SPECS
 * (longest match wins so 'archive-links' beats 'archive'). Anything that
 * doesn't match a known spec gets bucketed as 'misc'.
 */
async function collectVideos(): Promise<VideoFile[]> {
  if (!existsSync(PWO_DIR)) {
    return [];
  }
  const dirs = await readdir(PWO_DIR);
  const videos: VideoFile[] = [];

  // Sort by length DESC so 'archive-links' is checked before 'archive' would be.
  const specsByLength = [...KNOWN_SPECS].sort((a, b) => b.length - a.length);

  for (const d of dirs) {
    const videoPath = join(PWO_DIR, d, 'video.webm');
    if (!existsSync(videoPath)) continue;
    const st = await stat(videoPath);

    let spec = 'misc';
    for (const candidate of specsByLength) {
      if (d === candidate || d.startsWith(`${candidate}-`)) {
        spec = candidate;
        break;
      }
    }

    videos.push({
      spec,
      testName: d,
      size: st.size,
      src: videoPath,
    });
  }
  return videos;
}

function pickCanonicalPerSpec(videos: VideoFile[]): Map<string, VideoFile> {
  const bySpec = new Map<string, VideoFile>();
  for (const v of videos) {
    const cur = bySpec.get(v.spec);
    if (!cur || v.size > cur.size) {
      bySpec.set(v.spec, v);
    }
  }
  return bySpec;
}

async function main() {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      'no-run': { type: 'boolean' },
      spec: { type: 'string' },
    },
  });

  const taskId = values.task;
  if (!taskId || !/^\d+$/.test(taskId)) {
    console.error('error: pass --task <id>  (e.g., --task 116)');
    process.exit(1);
  }

  if (!values['no-run']) {
    const code = await runE2E();
    if (code !== 0) {
      console.error(`\n✗  e2e failed (exit ${code}); halting harvest. Fix tests, then re-run with --no-run to use the existing output.`);
      process.exit(code);
    }
    console.log();
  }

  console.log(`▶  Harvesting videos from ${PWO_DIR} → ${OUT_ROOT}/${taskId}/\n`);
  const videos = await collectVideos();
  if (videos.length === 0) {
    console.error(`✗  No videos found under ${PWO_DIR}. Did the e2e run produce recordings? Check playwright.config.ts: use.video should be 'on'.`);
    process.exit(1);
  }

  const canonical = pickCanonicalPerSpec(videos);
  if (values.spec) {
    for (const k of [...canonical.keys()]) {
      if (k !== values.spec) canonical.delete(k);
    }
  }

  const outDir = join(OUT_ROOT, taskId);
  await mkdir(outDir, { recursive: true });

  const manifest = {
    task: parseInt(taskId, 10),
    run_at: new Date().toISOString(),
    source: PWO_DIR,
    files: [] as Array<{ spec: string; file: string; size_bytes: number; src_test: string }>,
  };

  for (const [spec, v] of canonical) {
    const dest = join(outDir, `${spec}.webm`);
    await copyFile(v.src, dest);
    console.log(`  ✓  ${spec}.webm   ${(v.size / 1024).toFixed(0)} KB   from ${v.testName}`);
    manifest.files.push({
      spec,
      file: `${spec}.webm`,
      size_bytes: v.size,
      src_test: v.testName,
    });
  }

  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  ✓  manifest.json`);
  console.log(`\n✓  Harvested ${manifest.files.length} videos for plan task ${taskId}`);
  console.log(`   View at: /api/volume?path=test-recordings/e2e/${taskId}/<spec>.webm`);
  console.log(`   Add a 'video' field to details.ts[${taskId}] pointing at one of these to surface in the Gantt popup.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
