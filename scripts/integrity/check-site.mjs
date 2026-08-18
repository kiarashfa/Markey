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

// --- SPEC.md §12: noindex, never a robots.txt disallow ---------------------
/**
 * The rule this enforces is a trio, and all three parts have to hold together:
 * the page says `noindex`, the sitemap does not list it, and `robots.txt` does
 * **not** block it. Blocking is what makes the other two pointless — a URL that
 * is never fetched never has its `noindex` read.
 */
const NOINDEX_PATHS = ['/garage/'];

let robots = null;
try {
  robots = await readFile(path.join(dist, 'robots.txt'), 'utf8');
} catch {
  failures.push('robots.txt was not built (SPEC.md §12).');
}

const sitemapFiles = files.filter((f) => path.basename(f).startsWith('sitemap'));
let sitemapText = '';
for (const file of sitemapFiles) sitemapText += await readFile(file, 'utf8');
if (sitemapFiles.length === 0) failures.push('No sitemap was generated (SPEC.md §12).');

for (const noindexPath of NOINDEX_PATHS) {
  const page = path.join(dist, noindexPath.replace(/^\/|\/$/g, ''), 'index.html');
  try {
    const body = await readFile(page, 'utf8');
    if (!/name="robots"[^>]*noindex/i.test(body)) {
      failures.push(`${noindexPath} is missing its noindex meta (SPEC.md §12).`);
    }
    if (/data-pagefind-body/.test(body)) {
      failures.push(`${noindexPath} is marked for the search index but must not be indexed.`);
    }
  } catch {
    notes.push(`${noindexPath} not built — skipping its noindex check.`);
  }

  if (sitemapText.includes(`${BASE.replace(/\/$/, '')}${noindexPath}<`)) {
    failures.push(`${noindexPath} is listed in the sitemap but carries noindex (SPEC.md §12).`);
  }
  if (robots && new RegExp(`^\s*Disallow:.*${noindexPath}`, 'im').test(robots)) {
    failures.push(
      `robots.txt disallows ${noindexPath}. It must not: a blocked page is never fetched, so its noindex is never read (SPEC.md §12).`,
    );
  }
}

if (robots) {
  if (!/^Sitemap:\s*https?:\/\/\S+/m.test(robots)) {
    failures.push('robots.txt has no absolute Sitemap: line (SPEC.md §12).');
  } else {
    const declared = /^Sitemap:\s*(\S+)/m.exec(robots)?.[1] ?? '';
    if (!declared.includes(BASE)) {
      failures.push(`robots.txt points at ${declared}, which is outside the base path ${BASE}.`);
    }
  }
}

// --- the search index (SPEC.md §9.1) --------------------------------------
/**
 * Pagefind indexes only elements marked `data-pagefind-body` once any exist.
 * If the marker were dropped it would silently fall back to indexing every
 * `<body>`, which puts the nav and the footer into the text of all forty pages
 * — search still "works", and every result is wrong for the same reason.
 */
{
  const unmarked = [];
  for (const file of html) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const body = await readFile(file, 'utf8');
    const isNoindex = /name="robots"[^>]*noindex/i.test(body);
    if (!isNoindex && !body.includes('data-pagefind-body')) unmarked.push(rel);
  }
  if (unmarked.length > 0) {
    failures.push(
      `${unmarked.length} page(s) carry no data-pagefind-body and would fall out of search: ${unmarked.slice(0, 3).join(', ')}`,
    );
  }
}

// --- structured data (SPEC.md §12) ----------------------------------------
{
  let carPages = 0;
  let withCar = 0;
  let withBreadcrumbs = 0;
  for (const file of html) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const body = await readFile(file, 'utf8');
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    for (const [, json] of blocks) {
      let parsed;
      try {
        parsed = JSON.parse(json.replace(/\u003c/g, '<'));
      } catch (error) {
        failures.push(`${rel} has JSON-LD that is not valid JSON: ${error.message}`);
        continue;
      }
      if (parsed['@context'] !== 'https://schema.org') {
        failures.push(`${rel} has JSON-LD with no schema.org @context.`);
      }
      // An offer would make these encyclopedia pages claim to be listings.
      for (const forbidden of ['offers', 'price', 'aggregateRating']) {
        if (forbidden in parsed) {
          failures.push(`${rel} JSON-LD claims "${forbidden}", which no page here can honestly do.`);
        }
      }
      if (parsed['@type'] === 'Car') withCar++;
      if (parsed['@type'] === 'BreadcrumbList') withBreadcrumbs++;
    }
    if (/^cars\/[^/]+\/index\.html$/.test(rel)) {
      carPages++;
      if (!blocks.some(([, json]) => json.includes('"Car"'))) {
        failures.push(`${rel} has no Car structured data (SPEC.md §12).`);
      }
    }
  }
  notes.push(
    `Structured data: ${withCar} Car object(s) across ${carPages} car page(s), ${withBreadcrumbs} BreadcrumbList.`,
  );
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
