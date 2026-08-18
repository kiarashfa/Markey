#!/usr/bin/env node
/**
 * `npm run check:site` — post-build assertions against `dist/`.
 *
 * The one that matters most here is the **bundle check** required by SPEC.md
 * §9.5.1 and §13: the wind-tunnel solver must never enter the bundle of a page
 * that does not use it. It is the heaviest thing on the site, and a visitor who
 * only reads a spec page must not pay for it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dist = path.join(root, 'dist');

const failures = [];
const notes = [];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = await walk(dist);
const html = files.filter((f) => f.endsWith('.html'));
const js = files.filter((f) => f.endsWith('.js'));

if (html.length === 0) {
  failures.push('dist/ contains no HTML at all — did the build run?');
}

// --- base path -------------------------------------------------------------
const BASE = '/Markey/';
for (const file of html) {
  const body = await readFile(file, 'utf8');
  const bad = [...body.matchAll(/(?:href|src)="(\/[^"/][^"]*)"/g)]
    .map((m) => m[1])
    .filter((url) => !url.startsWith(BASE) && !url.startsWith('//'));
  if (bad.length > 0) {
    failures.push(
      `${path.relative(dist, file)} links outside the base path: ${[...new Set(bad)].slice(0, 3).join(', ')}`,
    );
  }
}

// --- /garage/ must be noindex, and must NOT be robots-blocked --------------
const garage = path.join(dist, 'garage', 'index.html');
try {
  const body = await readFile(garage, 'utf8');
  if (!/name="robots"[^>]*noindex/i.test(body)) {
    failures.push('/garage/ is missing its noindex meta (SPEC.md §12).');
  }
} catch {
  notes.push('/garage/ not built — skipping its noindex check.');
}

// --- the bundle check (SPEC.md §9.5.1) -------------------------------------
/**
 * The solver is identified by a string only it contains. Checking for a
 * filename would break the moment the bundler renames a chunk; checking for a
 * distinctive source string survives minification because it is inside a
 * template literal that becomes GLSL.
 */
const SOLVER_MARKER = 'EXT_color_buffer_float';
const LATTICE_MARKER = 'const vec3 CDIR';

const solverChunks = [];
for (const file of js) {
  const body = await readFile(file, 'utf8');
  if (body.includes(SOLVER_MARKER) || body.includes(LATTICE_MARKER)) {
    solverChunks.push(path.relative(dist, file));
  }
}

if (solverChunks.length === 0) {
  notes.push('No solver chunk found in dist/ — the wind tunnel may not be built yet.');
} else {
  // It must be a separate chunk, not folded into anything a normal page loads.
  const entryLike = solverChunks.filter((c) => /client|hoisted|index/i.test(path.basename(c)));
  if (entryLike.length > 0) {
    failures.push(
      `The wind-tunnel solver appears in what looks like a shared entry chunk: ${entryLike.join(', ')}. It must stay in its own lazily-imported chunk (SPEC.md §9.5.1).`,
    );
  }

  /**
   * Only a page that actually offers the tunnel may reference its chunk.
   *
   * Two do: Test Drive, and — since Phase 7 — Build Car, which runs the solver
   * over the shape the visitor is inventing and feeds the measured Cd and
   * frontal area back into the performance model (SPEC.md §9.6, the closed
   * loop). The rule this check exists to enforce is unchanged: a visitor who
   * only reads spec pages must never pay for the heaviest thing on the site.
   */
  const TUNNEL_PAGES = ['test-drive', 'build'];
  const solverBasenames = solverChunks.map((c) => path.basename(c));
  for (const file of html) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const body = await readFile(file, 'utf8');
    const referenced = solverBasenames.filter((name) => body.includes(name));
    if (referenced.length > 0 && !TUNNEL_PAGES.some((page) => rel.includes(page))) {
      failures.push(
        `${rel} eagerly references the wind-tunnel chunk (${referenced.join(', ')}). Only a page that offers the wind tunnel may: ${TUNNEL_PAGES.join(', ')}.`,
      );
    }
  }

  let bytes = 0;
  for (const chunk of solverChunks) bytes += (await stat(path.join(dist, chunk))).size;
  notes.push(
    `Wind-tunnel solver isolated in ${solverChunks.length} chunk(s), ${(bytes / 1024).toFixed(1)} kB, referenced only by ${TUNNEL_PAGES.join(' / ')} pages.`,
  );
}

// --- pagefind --------------------------------------------------------------
try {
  await stat(path.join(dist, 'pagefind', 'pagefind.js'));
} catch {
  notes.push('Pagefind index not found — expected until Phase 8 wires the search UI.');
}

// --- report ----------------------------------------------------------------
for (const note of notes) console.log(`[check:site] ${note}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} post-build violation(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\ncheck:site FAILED');
  process.exit(1);
}

console.log(`[check:site] passed — ${html.length} pages checked.`);
